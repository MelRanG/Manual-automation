import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models.user import User
from app.models.sr import SRDraft
from app.models.feedback import ApprovalRequest, ProposedDocumentChange
from app.models.document import Document


async def _seed_edit_case() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """Returns (user_id, sr_id, approval_id, proposed_change_id)."""
    async with SessionLocal() as session:
        user = User(id=uuid.uuid4(), name="r", email=f"{uuid.uuid4()}@t.com", role="admin")
        session.add(user)
        await session.flush()
        doc = Document(id=uuid.uuid4(), title="doc", owner_id=user.id)
        session.add(doc)
        sr = SRDraft(
            id=uuid.uuid4(), user_id=user.id, title="t", description="d",
            priority="medium", status="pending_doc_review", jira_issue_key="J-1",
        )
        session.add(sr)
        await session.flush()
        change = ProposedDocumentChange(
            id=uuid.uuid4(),
            document_id=doc.id,
            feedback_report_id=None,
            source_type="jira_sr",
            original_text="원본 본문",
            proposed_text="AI 제안 본문",
            diff="--- a\n+++ b\n",
            reasoning="test reasoning",
            confidence=0.9,
            status="pending",
        )
        session.add(change)
        await session.flush()
        approval = ApprovalRequest(
            id=uuid.uuid4(),
            approval_type="doc_review",
            sr_draft_id=sr.id,
            proposed_change_id=change.id,
            status="pending",
        )
        session.add(approval)
        await session.commit()
        return user.id, sr.id, approval.id, change.id


@pytest.mark.asyncio(loop_scope="session")
async def test_edit_and_approve_overwrites_proposed_text_and_marks_action(client: AsyncClient):
    user_id, sr_id, approval_id, change_id = await _seed_edit_case()
    edited = "사람이 다듬은 최종 본문"

    res = await client.post(
        f"/api/approvals/{approval_id}/doc-review",
        json={
            "reviewer_id": str(user_id),
            "action": "edit_and_approve",
            "edited_content": edited,
            "comment": "오타 수정",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "approved"
    assert body["action"] == "edit_and_approve"
    assert body["edited_content"] == edited
    assert body["comment"] == "오타 수정"

    async with SessionLocal() as session:
        change = (await session.execute(
            select(ProposedDocumentChange).where(ProposedDocumentChange.id == change_id)
        )).scalar_one()
        assert change.proposed_text == edited
        sr = (await session.execute(select(SRDraft).where(SRDraft.id == sr_id))).scalar_one()
        assert sr.status == "done_synced"


@pytest.mark.asyncio(loop_scope="session")
async def test_edit_and_approve_missing_edited_content_rejected(client: AsyncClient):
    user_id, _, approval_id, _ = await _seed_edit_case()
    res = await client.post(
        f"/api/approvals/{approval_id}/doc-review",
        json={"reviewer_id": str(user_id), "action": "edit_and_approve"},
    )
    assert res.status_code == 400
    assert "edited_content" in res.json()["detail"]


@pytest.mark.asyncio(loop_scope="session")
async def test_approve_doc_records_action(client: AsyncClient):
    user_id, _, approval_id, _ = await _seed_edit_case()
    res = await client.post(
        f"/api/approvals/{approval_id}/doc-review",
        json={"reviewer_id": str(user_id), "action": "approve_doc"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["action"] == "approve_doc"
    assert body["status"] == "approved"


@pytest.mark.asyncio(loop_scope="session")
async def test_reject_records_action_and_comment(client: AsyncClient):
    user_id, sr_id, approval_id, _ = await _seed_edit_case()
    res = await client.post(
        f"/api/approvals/{approval_id}/doc-review",
        json={"reviewer_id": str(user_id), "action": "reject", "comment": "변경 없음"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["action"] == "reject"
    assert body["status"] == "rejected"
    assert body["comment"] == "변경 없음"

    async with SessionLocal() as session:
        sr = (await session.execute(select(SRDraft).where(SRDraft.id == sr_id))).scalar_one()
        assert sr.status == "done_no_proposal"
