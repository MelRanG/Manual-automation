"""Phase 2: 문서 반영 판단 로직 테스트.

페르소나:
- 김운영: SR 제출 후 Jira 완료되면 관련 문서가 자동 업데이트되길 기대
- 박문서: 불필요한 문서 변경이 남발되지 않는지, 판단 근거가 명확한지 검토
"""
import json
import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.document_reflection_service import (
    judge_document_reflection,
    judge_manual_generation,
    _parse_json_response,
)


class TestParseJsonResponse:
    def test_plain_json(self):
        text = '{"needs_update": true, "strategy": "update_existing", "confidence": 0.9, "reasoning": "test"}'
        result = _parse_json_response(text)
        assert result["needs_update"] is True

    def test_json_in_code_block(self):
        text = '```json\n{"needs_update": false, "strategy": "no_action", "confidence": 0.8, "reasoning": "no change"}\n```'
        result = _parse_json_response(text)
        assert result["needs_update"] is False

    def test_json_with_surrounding_text(self):
        text = 'Here is my analysis:\n{"needs_update": true, "strategy": "add_section", "confidence": 0.7, "reasoning": "new feature"}\nDone.'
        result = _parse_json_response(text)
        assert result["strategy"] == "add_section"


@pytest.mark.asyncio
async def test_judge_reflection_update_needed():
    """김운영: VPN 설정 변경 SR 완료 → 문서 업데이트 필요 판단"""
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(return_value=json.dumps({
        "needs_update": True,
        "strategy": "update_existing",
        "confidence": 0.92,
        "reasoning": "VPN 접속 절차가 변경되어 기존 매뉴얼 업데이트 필요",
    }))

    result = await judge_document_reflection(
        mock_llm,
        sr_title="VPN 접속 방식 변경",
        sr_description="기존 L2TP에서 WireGuard로 VPN 프로토콜 전환",
        sr_priority="high",
        doc_title="VPN 접속 가이드",
        doc_content="# VPN 접속 가이드\n1. L2TP 클라이언트 설치...",
    )

    assert result.needs_update is True
    assert result.strategy == "update_existing"
    assert result.confidence > 0.8


@pytest.mark.asyncio
async def test_judge_reflection_no_action():
    """박문서: 무관한 SR은 문서 변경하지 않음"""
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(return_value=json.dumps({
        "needs_update": False,
        "strategy": "no_action",
        "confidence": 0.95,
        "reasoning": "DB 인덱스 추가는 사용자 매뉴얼과 무관",
    }))

    result = await judge_document_reflection(
        mock_llm,
        sr_title="주문 테이블 인덱스 추가",
        sr_description="order_date 컬럼에 B-tree 인덱스 생성",
        sr_priority="low",
        doc_title="주문 관리 사용자 가이드",
        doc_content="# 주문 관리\n주문을 조회하려면...",
    )

    assert result.needs_update is False
    assert result.strategy == "no_action"


@pytest.mark.asyncio
async def test_judge_reflection_add_section():
    """김운영: 새 기능 추가 SR → 문서에 섹션 추가"""
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(return_value=json.dumps({
        "needs_update": True,
        "strategy": "add_section",
        "confidence": 0.85,
        "reasoning": "새로운 대량 다운로드 기능이 추가되어 가이드에 섹션 추가 필요",
    }))

    result = await judge_document_reflection(
        mock_llm,
        sr_title="대량 다운로드 기능 추가",
        sr_description="1000건 이상 데이터를 CSV로 일괄 다운로드하는 기능",
        sr_priority="medium",
        doc_title="데이터 내보내기 가이드",
        doc_content="# 데이터 내보내기\n현재 최대 100건까지 내보낼 수 있습니다.",
    )

    assert result.needs_update is True
    assert result.strategy == "add_section"


@pytest.mark.asyncio
async def test_judge_reflection_llm_failure_fallback():
    """LLM 호출 실패 시 안전하게 기본값 반환"""
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(side_effect=RuntimeError("LLM timeout"))

    result = await judge_document_reflection(
        mock_llm,
        sr_title="SR",
        sr_description="desc",
        sr_priority="medium",
        doc_title="doc",
        doc_content="content",
    )

    assert result.needs_update is True
    assert result.strategy == "update_existing"
    assert result.confidence < 0.5


@pytest.mark.asyncio
async def test_judge_manual_generation_needed():
    """김운영: UI 변경 SR은 매뉴얼 재생성 필요"""
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(return_value=json.dumps({
        "needs_manual_generation": True,
        "confidence": 0.88,
        "reasoning": "로그인 화면 UI가 변경되어 스크린샷 갱신 필요",
    }))

    result = await judge_manual_generation(
        mock_llm,
        sr_title="로그인 화면 UI 개편",
        sr_description="로그인 페이지를 Material Design 3 기반으로 리디자인",
        target_url="https://app.example.com/login",
    )

    assert result.needs_manual_generation is True
    assert result.confidence > 0.8


@pytest.mark.asyncio
async def test_judge_manual_generation_not_needed():
    """박문서: 백엔드 변경은 매뉴얼 재생성 불필요"""
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(return_value=json.dumps({
        "needs_manual_generation": False,
        "confidence": 0.93,
        "reasoning": "API 응답 속도 개선은 UI 변경 없음",
    }))

    result = await judge_manual_generation(
        mock_llm,
        sr_title="API 응답 캐싱 적용",
        sr_description="Redis 캐시 레이어 추가로 응답 시간 50% 단축",
        target_url="https://app.example.com/dashboard",
    )

    assert result.needs_manual_generation is False


@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_with_reflection_judgment(client, db_session):
    """통합: LLM 판단으로 no_action이면 수정안 미생성"""
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.models.document import Document, DocumentVersion
    from app.models.feedback import ProposedDocumentChange
    from app.services import jira_service
    from sqlalchemy import select

    resp = await client.post("/api/users", json={
        "name": "Phase2 Test",
        "email": f"phase2_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    user_id = uuid.UUID(resp.json()["id"])

    doc = Document(
        id=uuid.uuid4(), title="무관한 문서", description="",
        owner_id=user_id, status="active", priority="medium", trust_score=1.0,
    )
    db_session.add(doc)
    await db_session.flush()
    version = DocumentVersion(
        id=uuid.uuid4(), document_id=doc.id, version_number=1,
        content="내용", created_by=user_id, change_summary="초기",
    )
    db_session.add(version)
    await db_session.flush()
    doc.current_version_id = version.id

    sr = SRDraft(
        id=uuid.uuid4(), user_id=user_id,
        title="DB 인덱스 추가", description="성능 개선용",
        priority="low", status="submitted",
        created_by_ai=False, target_url=None,
    )
    db_session.add(sr)
    await db_session.flush()
    log = JiraCallbackLog(
        id=uuid.uuid4(), jira_issue_key="TEST-P2-1",
        event_type="jira:issue_updated", payload={},
        status="pending", sr_draft_id=sr.id,
    )
    db_session.add(log)
    await db_session.commit()

    mock_chunk = {
        "document_id": doc.id, "document_title": doc.title,
        "content": "내용", "distance": 0.3,
    }

    no_action_response = json.dumps({
        "needs_update": False,
        "strategy": "no_action",
        "confidence": 0.95,
        "reasoning": "DB 작업은 문서와 무관",
    })
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(return_value=no_action_response)

    with patch("app.services.jira_service._find_related_documents", return_value=[mock_chunk]), \
         patch("app.services.llm_service.get_llm_provider", return_value=mock_llm):
        await jira_service.process_jira_done(sr.id, log.id, db=db_session)

    await db_session.refresh(sr)
    assert sr.status == "done_no_proposal"

    proposals = (await db_session.execute(
        select(ProposedDocumentChange).where(ProposedDocumentChange.document_id == doc.id)
    )).scalars().all()
    assert len(proposals) == 0
