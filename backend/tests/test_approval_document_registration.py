"""Phase 3: 승인→문서 등록 흐름 테스트.

페르소나:
- 김운영: SR 완료 후 생성된 수정안을 승인하면 문서가 실제 갱신되는지 확인
- 박문서: 승인 시 source_type, document_type 메타데이터가 문서에 정확히 설정되는지 검토
"""
import uuid

import pytest
from sqlalchemy import select

from app.models.document import Document, DocumentVersion
from app.models.feedback import ProposedDocumentChange, ApprovalRequest
from app.services import approval_service


@pytest.mark.asyncio(loop_scope="session")
async def test_approve_jira_sr_updates_existing_document(client, db_session):
    """김운영: jira_sr 수정안 승인 → 기존 문서에 새 버전 생성"""
    resp = await client.post("/api/users", json={
        "name": "김운영",
        "email": f"kim_ops_{uuid.uuid4().hex[:8]}@example.com",
        "role": "admin",
    })
    user_id = uuid.UUID(resp.json()["id"])

    doc = Document(
        id=uuid.uuid4(), title="VPN 가이드", description="VPN 접속 방법",
        owner_id=user_id, status="active", priority="medium", trust_score=1.0,
        document_type="user_manual", source_type="manual",
    )
    db_session.add(doc)
    await db_session.flush()
    version = DocumentVersion(
        id=uuid.uuid4(), document_id=doc.id, version_number=1,
        content="# VPN 가이드\n기존 내용", created_by=user_id, change_summary="초기",
    )
    db_session.add(version)
    await db_session.flush()
    doc.current_version_id = version.id

    change = ProposedDocumentChange(
        id=uuid.uuid4(),
        feedback_report_id=None,
        document_id=doc.id,
        document_version_id=version.id,
        manual_job_id=None,
        original_text="# VPN 가이드\n기존 내용",
        proposed_text="# VPN 가이드\n수정된 WireGuard 접속 절차",
        diff="",
        reasoning="[update_existing] VPN 프로토콜 변경 반영",
        confidence=0.9,
        source_type="jira_sr",
        status="pending",
    )
    db_session.add(change)
    await db_session.flush()

    approval = ApprovalRequest(
        id=uuid.uuid4(),
        proposed_change_id=change.id,
        status="pending",
    )
    db_session.add(approval)
    await db_session.commit()

    result = await approval_service.review_approval(
        db_session, approval.id, user_id, "approved", comment="확인됨"
    )
    assert result.status == "approved"

    # 문서에 새 버전이 생겼는지 확인
    versions = (await db_session.execute(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == doc.id)
        .order_by(DocumentVersion.version_number.desc())
    )).scalars().all()
    assert len(versions) == 2
    assert "WireGuard" in versions[0].content


@pytest.mark.asyncio(loop_scope="session")
async def test_approve_jira_sr_create_new_doc(client, db_session):
    """박문서: [create_new_doc] 전략 승인 → 신규 문서 생성"""
    resp = await client.post("/api/users", json={
        "name": "박문서",
        "email": f"park_doc_{uuid.uuid4().hex[:8]}@example.com",
        "role": "admin",
    })
    reviewer_id = uuid.UUID(resp.json()["id"])

    # 기존 문서 (참조용)
    ref_doc = Document(
        id=uuid.uuid4(), title="참조 문서", description="",
        owner_id=reviewer_id, status="active", priority="medium", trust_score=1.0,
    )
    db_session.add(ref_doc)
    await db_session.flush()
    ref_ver = DocumentVersion(
        id=uuid.uuid4(), document_id=ref_doc.id, version_number=1,
        content="기존 내용", created_by=reviewer_id, change_summary="초기",
    )
    db_session.add(ref_ver)
    await db_session.flush()
    ref_doc.current_version_id = ref_ver.id

    change = ProposedDocumentChange(
        id=uuid.uuid4(),
        feedback_report_id=None,
        document_id=ref_doc.id,
        document_version_id=ref_ver.id,
        manual_job_id=None,
        original_text="기존 내용",
        proposed_text="# 새 시스템 운영 가이드\n완전히 새로운 문서 내용",
        diff="",
        reasoning="[create_new_doc] 새 시스템 도입으로 별도 문서 필요",
        confidence=0.85,
        source_type="jira_sr",
        status="pending",
    )
    db_session.add(change)
    await db_session.flush()

    approval = ApprovalRequest(
        id=uuid.uuid4(),
        proposed_change_id=change.id,
        status="pending",
    )
    db_session.add(approval)
    await db_session.commit()

    result = await approval_service.review_approval(
        db_session, approval.id, reviewer_id, "approved"
    )
    assert result.status == "approved"

    # 새로운 Document가 생성되었는지 확인
    new_docs = (await db_session.execute(
        select(Document).where(Document.source_type == "jira_sr")
    )).scalars().all()
    assert len(new_docs) >= 1
    new_doc = new_docs[-1]
    assert new_doc.document_type == "operation_guide"
    assert "새 시스템" in new_doc.title


@pytest.mark.asyncio(loop_scope="session")
async def test_approve_playwright_sets_metadata(client, db_session):
    """박문서: Playwright 매뉴얼 승인 시 document_type=user_manual 설정"""
    resp = await client.post("/api/users", json={
        "name": "Reviewer",
        "email": f"reviewer_{uuid.uuid4().hex[:8]}@example.com",
        "role": "admin",
    })
    reviewer_id = uuid.UUID(resp.json()["id"])

    change = ProposedDocumentChange(
        id=uuid.uuid4(),
        feedback_report_id=None,
        document_id=None,
        document_version_id=None,
        manual_job_id=None,
        original_text="",
        proposed_text="# 매뉴얼\n스크린샷 기반 가이드",
        diff="",
        reasoning="Playwright auto-generated manual for https://app.example.com",
        confidence=1.0,
        source_type="playwright",
        status="pending",
    )
    db_session.add(change)
    await db_session.flush()

    approval = ApprovalRequest(
        id=uuid.uuid4(),
        proposed_change_id=change.id,
        status="pending",
    )
    db_session.add(approval)
    await db_session.commit()

    result = await approval_service.review_approval(
        db_session, approval.id, reviewer_id, "approved"
    )
    assert result.status == "approved"

    # 생성된 문서의 메타데이터 확인
    docs = (await db_session.execute(
        select(Document).where(Document.source_type == "playwright")
    )).scalars().all()
    assert len(docs) >= 1
    assert docs[-1].document_type == "user_manual"
