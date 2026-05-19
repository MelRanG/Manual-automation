import json
import logging
import uuid
from collections.abc import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatSession, ChatMessage, AnswerCitation
from app.models.document import Document
from app.models.sr import SRDraft
from app.services.llm_service import get_llm_provider
from app.services.search_service import search_similar_chunks

logger = logging.getLogger(__name__)

RAG_SYSTEM_PROMPT = """당신은 Manual Automation 문서 관리 시스템의 AI 어시스턴트입니다.
문서 컨텍스트를 기반으로 질문에 답변합니다.

사용자 메시지가 "[변경 요청]"으로 시작하면, 이것은 SR(서비스 요청) 등록 대화입니다.
이 경우 다음 필수 정보가 모두 충족됐는지 판단하세요:
  1. 제목 — 무엇을 변경해야 하는지 명확히 알 수 있는 한 줄 제목
  2. 내용 — 변경 이유, 현재 문제, 원하는 결과 등 구체적인 설명
  3. 우선순위 — high / medium / low 중 하나

[필수 정보가 부족한 경우]
부족한 항목이 무엇인지 친절하게 안내하고, 추가 질문으로만 응답하세요.
절대 sr_proposal 블록을 포함하지 마세요.

[필수 정보가 모두 충족된 경우]
답변 맨 끝에 반드시 아래 SR 제안 블록을 포함하세요:

```sr_proposal
{"is_change_request": true, "title": "간결한 SR 제목", "description": "구체적인 변경 내용 설명", "priority": "medium", "target_document": "관련 문서 제목"}
```

priority: high(긴급)/medium(보통)/low(낮음)

"[변경 요청]"으로 시작하지 않는 일반 질문에는 SR 블록 없이 답변만 하세요.
답변은 반드시 한국어로 작성합니다."""


def _extract_sr_proposal(text: str) -> dict | None:
    """LLM 응답에서 ```sr_proposal JSON 블록을 추출."""
    import re
    match = re.search(r"```sr_proposal\s*\n(.*?)\n```", text, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        if data.get("is_change_request"):
            return data
    except (json.JSONDecodeError, KeyError):
        pass
    return None


def _strip_sr_block(text: str) -> str:
    """사용자에게 보여줄 답변에서 sr_proposal 블록 제거."""
    import re
    return re.sub(r"\s*```sr_proposal\s*\n.*?\n```", "", text, flags=re.DOTALL).strip()


async def create_session(db: AsyncSession, user_id: uuid.UUID, title: str | None = None) -> ChatSession:
    session = ChatSession(
        id=uuid.uuid4(),
        user_id=user_id,
        title=title,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def get_session(db: AsyncSession, session_id: uuid.UUID) -> ChatSession | None:
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    return result.scalar_one_or_none()


async def list_sessions(db: AsyncSession, user_id: uuid.UUID) -> list[ChatSession]:
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user_id)
        .order_by(ChatSession.created_at.desc())
    )
    return list(result.scalars().all())


async def get_messages(db: AsyncSession, session_id: uuid.UUID) -> list[ChatMessage]:
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return list(result.scalars().all())


async def ask_question(
    db: AsyncSession, session_id: uuid.UUID, question: str
) -> dict:
    session = await get_session(db, session_id)
    if not session:
        raise ValueError("Session not found")

    user_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    await db.flush()

    relevant_chunks = await search_similar_chunks(db, question, top_k=5)

    context = "\n\n---\n\n".join(
        f"[{c['document_title']}] {c['content']}" for c in relevant_chunks
    )

    llm = get_llm_provider()
    answer = await llm.generate(RAG_SYSTEM_PROMPT, question, context)

    # SR 제안 감지 — 변경 요청 탭에서 보낸 메시지일 때만 처리
    sr_proposal = _extract_sr_proposal(answer) if question.startswith("[변경 요청]") else None
    sr_draft_data = None
    if sr_proposal:
        try:
            sr_draft = SRDraft(
                id=uuid.uuid4(),
                user_id=session.user_id,
                title=sr_proposal["title"],
                description=sr_proposal["description"],
                priority=sr_proposal.get("priority", "medium"),
                status="draft",
                created_by_ai=True,
                related_document_ids=None,
            )
            db.add(sr_draft)
            await db.flush()
            sr_draft_data = {
                "id": str(sr_draft.id),
                "title": sr_draft.title,
                "description": sr_draft.description,
                "priority": sr_draft.priority,
            }
            logger.info(f"챗봇 SR 자동 생성: {sr_draft.title}")
        except Exception as e:
            logger.warning(f"SR 자동 생성 실패: {e}")

    display_answer = _strip_sr_block(answer)

    assistant_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="assistant",
        content=display_answer,
    )
    db.add(assistant_msg)
    await db.flush()

    citations = []
    for chunk in relevant_chunks:
        citation = AnswerCitation(
            id=uuid.uuid4(),
            chat_message_id=assistant_msg.id,
            document_id=chunk["document_id"],
            document_version_id=chunk["document_version_id"],
            chunk_id=chunk["chunk_id"],
            quote=chunk["content"][:200],
        )
        db.add(citation)
        citations.append({
            "document_id": str(chunk["document_id"]),
            "document_title": chunk["document_title"],
            "quote": chunk["content"][:200],
            "chunk_id": str(chunk["chunk_id"]),
        })

    await db.commit()

    if not session.title and len(question) > 0:
        session.title = question[:100]
        await db.commit()

    warnings = []
    seen_doc_ids = set()
    for chunk in relevant_chunks:
        doc_id = chunk["document_id"]
        if doc_id in seen_doc_ids:
            continue
        seen_doc_ids.add(doc_id)
        doc_result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = doc_result.scalar_one_or_none()
        if doc:
            if doc.trust_score < 0.6:
                warnings.append({"document_id": str(doc_id), "title": doc.title, "reason": "trust_score_low"})
            elif doc.status == "stale":
                warnings.append({"document_id": str(doc_id), "title": doc.title, "reason": "stale"})

    result = {
        "message_id": str(assistant_msg.id),
        "content": display_answer,
        "citations": citations,
        "warnings": warnings,
    }
    if sr_draft_data:
        result["sr_draft"] = sr_draft_data
    return result


async def ask_question_stream(
    db: AsyncSession, session_id: uuid.UUID, question: str
) -> AsyncGenerator[str, None]:
    session = await get_session(db, session_id)
    if not session:
        raise ValueError("Session not found")

    user_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    await db.flush()

    relevant_chunks = await search_similar_chunks(db, question, top_k=5)

    context = "\n\n---\n\n".join(
        f"[{c['document_title']}] {c['content']}" for c in relevant_chunks
    )

    llm = get_llm_provider()
    full_content = ""

    async for token in llm.generate_stream(RAG_SYSTEM_PROMPT, question, context):
        full_content += token
        yield f"event: token\ndata: {json.dumps({'token': token})}\n\n"

    # SR 제안 감지 — 변경 요청 탭에서 보낸 메시지일 때만 처리
    sr_proposal = _extract_sr_proposal(full_content) if question.startswith("[변경 요청]") else None
    sr_draft_data = None
    if sr_proposal:
        try:
            sr_draft = SRDraft(
                id=uuid.uuid4(),
                user_id=session.user_id,
                title=sr_proposal["title"],
                description=sr_proposal["description"],
                priority=sr_proposal.get("priority", "medium"),
                status="draft",
                created_by_ai=True,
                related_document_ids=None,
            )
            db.add(sr_draft)
            await db.flush()
            sr_draft_data = {
                "id": str(sr_draft.id),
                "title": sr_draft.title,
                "description": sr_draft.description,
                "priority": sr_draft.priority,
            }
        except Exception as e:
            logger.warning(f"SR 자동 생성 실패 (stream): {e}")

    display_content = _strip_sr_block(full_content)

    assistant_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="assistant",
        content=display_content,
    )
    db.add(assistant_msg)
    await db.flush()

    citations = []
    for chunk in relevant_chunks:
        citation = AnswerCitation(
            id=uuid.uuid4(),
            chat_message_id=assistant_msg.id,
            document_id=chunk["document_id"],
            document_version_id=chunk["document_version_id"],
            chunk_id=chunk["chunk_id"],
            quote=chunk["content"][:200],
        )
        db.add(citation)
        citations.append({
            "document_id": str(chunk["document_id"]),
            "document_title": chunk["document_title"],
            "quote": chunk["content"][:200],
            "chunk_id": str(chunk["chunk_id"]),
        })

    await db.commit()

    if not session.title and len(question) > 0:
        session.title = question[:100]
        await db.commit()

    warnings = []
    seen_doc_ids = set()
    for chunk in relevant_chunks:
        doc_id = chunk["document_id"]
        if doc_id in seen_doc_ids:
            continue
        seen_doc_ids.add(doc_id)
        doc_result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = doc_result.scalar_one_or_none()
        if doc:
            if doc.trust_score < 0.6:
                warnings.append({"document_id": str(doc_id), "title": doc.title, "reason": "trust_score_low"})
            elif doc.status == "stale":
                warnings.append({"document_id": str(doc_id), "title": doc.title, "reason": "stale"})

    done_data: dict = {"message_id": str(assistant_msg.id), "citations": citations, "warnings": warnings}
    if sr_draft_data:
        done_data["sr_draft"] = sr_draft_data
    yield f"event: citations\ndata: {json.dumps({'citations': citations, 'warnings': warnings})}\n\n"
    yield f"event: done\ndata: {json.dumps(done_data)}\n\n"
