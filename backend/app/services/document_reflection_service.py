"""SR 완료 시 문서 반영 판단 및 전략 결정 서비스.

LLM을 사용해:
1. 문서 업데이트 필요 여부 판단 (document_update_needed)
2. 반영 전략 결정 (update_existing / add_section / create_new_doc / no_action)
3. 매뉴얼 자동생성 필요 여부 판단
"""

import json
import logging
from dataclasses import dataclass

from app.services.llm_service import LLMProvider

logger = logging.getLogger(__name__)

REFLECTION_JUDGMENT_PROMPT = """\
당신은 기술 문서 관리 전문가입니다.
서비스 요청(SR)이 완료되었을 때, 기존 문서를 업데이트해야 하는지 판단합니다.

아래 정보를 분석하고 JSON으로 응답하세요:

## SR 정보
- 제목: {sr_title}
- 설명: {sr_description}
- 우선순위: {sr_priority}

## 현재 문서
- 제목: {doc_title}
- 내용 (처음 2000자):
{doc_content}

## 판단 기준
1. SR 내용이 문서와 관련 있는가?
2. 문서에 반영해야 할 변경사항이 있는가?
3. 어떤 방식으로 반영해야 하는가?

## 응답 형식 (JSON만 출력)
{{
  "needs_update": true/false,
  "strategy": "update_existing" | "add_section" | "create_new_doc" | "no_action",
  "confidence": 0.0~1.0,
  "reasoning": "판단 근거 1~2문장"
}}

strategy 설명:
- update_existing: 기존 문서 내용 일부를 수정
- add_section: 기존 문서에 새 섹션 추가
- create_new_doc: 별도 신규 문서 생성 필요
- no_action: 반영 불필요
"""

MANUAL_GENERATION_JUDGMENT_PROMPT = """\
당신은 사용자 매뉴얼 전문가입니다.
SR 완료 후 사용자 매뉴얼(스크린샷 기반 가이드)을 새로 생성하거나 갱신해야 하는지 판단합니다.

## SR 정보
- 제목: {sr_title}
- 설명: {sr_description}
- 대상 URL: {target_url}

## 판단 기준
1. SR이 UI/화면 변경을 포함하는가?
2. 사용자가 조작하는 절차가 변경되었는가?
3. 스크린샷 기반 매뉴얼이 필요한 종류의 변경인가?

## 응답 형식 (JSON만 출력)
{{
  "needs_manual_generation": true/false,
  "confidence": 0.0~1.0,
  "reasoning": "판단 근거 1~2문장"
}}
"""


@dataclass
class ReflectionJudgment:
    needs_update: bool
    strategy: str
    confidence: float
    reasoning: str


@dataclass
class ManualGenerationJudgment:
    needs_manual_generation: bool
    confidence: float
    reasoning: str


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        text = "\n".join(lines)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        raise


async def judge_document_reflection(
    llm: LLMProvider,
    sr_title: str,
    sr_description: str,
    sr_priority: str,
    doc_title: str,
    doc_content: str,
) -> ReflectionJudgment:
    prompt = REFLECTION_JUDGMENT_PROMPT.format(
        sr_title=sr_title,
        sr_description=sr_description,
        sr_priority=sr_priority,
        doc_title=doc_title,
        doc_content=doc_content[:2000],
    )

    try:
        response = await llm.generate(
            "당신은 기술 문서 관리 전문가입니다. JSON만 출력합니다.",
            prompt,
        )
        data = _parse_json_response(response)
        return ReflectionJudgment(
            needs_update=data.get("needs_update", False),
            strategy=data.get("strategy", "no_action"),
            confidence=data.get("confidence", 0.5),
            reasoning=data.get("reasoning", ""),
        )
    except Exception as e:
        logger.warning(f"LLM 반영 판단 실패, 기본값 사용: {e}")
        return ReflectionJudgment(
            needs_update=True,
            strategy="update_existing",
            confidence=0.3,
            reasoning=f"LLM 판단 실패로 기본 업데이트 진행: {e}",
        )


async def judge_manual_generation(
    llm: LLMProvider,
    sr_title: str,
    sr_description: str,
    target_url: str,
) -> ManualGenerationJudgment:
    prompt = MANUAL_GENERATION_JUDGMENT_PROMPT.format(
        sr_title=sr_title,
        sr_description=sr_description,
        target_url=target_url,
    )

    try:
        response = await llm.generate(
            "당신은 사용자 매뉴얼 전문가입니다. JSON만 출력합니다.",
            prompt,
        )
        data = _parse_json_response(response)
        return ManualGenerationJudgment(
            needs_manual_generation=data.get("needs_manual_generation", False),
            confidence=data.get("confidence", 0.5),
            reasoning=data.get("reasoning", ""),
        )
    except Exception as e:
        logger.warning(f"LLM 매뉴얼 생성 판단 실패, 기본값 사용: {e}")
        return ManualGenerationJudgment(
            needs_manual_generation=True,
            confidence=0.3,
            reasoning=f"LLM 판단 실패로 기본 생성 진행: {e}",
        )
