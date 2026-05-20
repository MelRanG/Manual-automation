"""SR 문서 작업 전략 추천 — LLM 호출 + 결과 검증."""
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.document import Document
from app.models.sr import SRDraft
from app.services.llm_service import get_llm_provider

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = (
    "당신은 서비스 요청(SR) 처리 후 문서 작업 전략을 추천하는 분석가입니다. "
    "다음 세 가지 중 하나를 고르고 짧은 이유(1-3줄, 한국어)를 함께 출력하세요.\n"
    "- new: 신규 문서가 필요하다 (기존 문서 중 적합한 것이 없음).\n"
    "- existing: 기존 문서 중 하나를 수정한다 (어떤 문서인지 document_id 포함).\n"
    "- none: 문서 수정이 필요 없다.\n"
    "\n"
    "오직 JSON만 출력하세요. 형식:\n"
    '{"recommendation": "new"|"existing"|"none", '
    '"reason": "1-3줄 한국어", '
    '"suggested_document_id": "uuid 또는 null"}'
)


def _model_id() -> str:
    if settings.llm_provider == "bedrock":
        return getattr(settings, "bedrock_model_id", "bedrock") or "bedrock"
    if settings.llm_provider == "anthropic":
        return "claude-sonnet-4-6"
    if settings.llm_provider == "openai":
        return "gpt-4o"
    return "mock"


async def recommend_doc_strategy(db: AsyncSession, sr_draft: SRDraft) -> dict:
    """LLM 호출 → 검증 → SRDraft.ai_doc_recommendation 갱신 → 결과 반환."""

    # 1. 문서 메타데이터 수집 (최대 50개)
    docs_result = await db.execute(
        select(Document.id, Document.title, Document.description).limit(50)
    )
    docs = [
        {"id": str(row.id), "title": row.title, "description": (row.description or "")[:200]}
        for row in docs_result
    ]
    doc_ids_set = {d["id"] for d in docs}

    # 2. user message 구성
    user_message = (
        f"SR 제목: {sr_draft.title}\n"
        f"SR 설명: {sr_draft.description}\n"
        f"우선순위: {sr_draft.priority}\n"
        f"대상 URL: {sr_draft.target_url or '(없음)'}\n"
        f"\n현재 등록된 문서 목록 (id, 제목, 요약):\n"
        + "\n".join(f"- {d['id']} | {d['title']} | {d['description']}" for d in docs)
    )

    # 3. LLM 호출
    llm = get_llm_provider()
    raw = await llm.generate(SYSTEM_PROMPT, user_message)

    # 4. JSON 추출
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError(f"LLM response did not contain JSON: {raw[:200]}")
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM response JSON parse failed: {e}") from e

    # 5. 검증
    rec = parsed.get("recommendation")
    if rec not in ("new", "existing", "none"):
        raise ValueError(f"Invalid recommendation value: {rec}")

    reason = parsed.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("reason is missing or empty")

    suggested = parsed.get("suggested_document_id")
    suggested_str: str | None = None
    if rec == "existing" and suggested:
        # 유효 uuid + 실존 문서 확인
        try:
            uuid.UUID(str(suggested))
            if str(suggested) in doc_ids_set:
                suggested_str = str(suggested)
        except (ValueError, TypeError):
            suggested_str = None

    payload = {
        "recommendation": rec,
        "reason": reason.strip(),
        "suggested_document_id": suggested_str,
        "model": _model_id(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # 6. 저장
    sr_draft.ai_doc_recommendation = payload
    await db.commit()
    await db.refresh(sr_draft)

    return payload
