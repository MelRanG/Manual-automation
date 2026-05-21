import uuid
import pytest
from httpx import AsyncClient

from app.db import SessionLocal
from app.models.user import User
from app.models.sr import SRDraft
from app.models.feedback import ApprovalRequest, ProposedDocumentChange
from app.models.document import Document


async def _seed(action: str, status: str, with_proposal: bool = True):
    async with SessionLocal() as session:
        user = User(id=uuid.uuid4(), name="검토자A", email=f"{uuid.uuid4()}@t.com", role="admin")
        session.add(user)
        await session.flush()
        doc = Document(id=uuid.uuid4(), title="대상 문서", owner_id=user.id)
        session.add(doc)
        sr = SRDraft(
            id=uuid.uuid4(), user_id=user.id, title="t", description="d",
            priority="medium", status=status, jira_issue_key="J-1",
            ai_doc_recommendation={"recommendation": "existing", "reason": "이미 있는 문서 갱신", "suggested_document_id": str(doc.id), "model": "x", "created_at": "2026-01-01T00:00:00Z"},
        )
        session.add(sr)
        await session.flush()
        change_id = None
        if with_proposal:
            change = ProposedDocumentChange(
                id=uuid.uuid4(),
                document_id=doc.id,
                feedback_report_id=None,
                source_type="jira_sr",
                original_text="원본 본문",
                proposed_text="최종 적용 본문",
                diff="--- a\n+++ b\n",
                reasoning="test",
                confidence=0.9,
                status="approved",
            )
            session.add(change)
            await session.flush()
            change_id = change.id

        approval = ApprovalRequest(
            id=uuid.uuid4(),
            approval_type="doc_review",
            sr_draft_id=sr.id,
            proposed_change_id=change_id,
            status="approved" if action != "reject" else "rejected",
            action=action,
            comment="검토 코멘트",
            edited_content="최종 적용 본문" if action == "edit_and_approve" else None,
            reviewer_id=user.id,
            reviewed_at="2026-01-02T00:00:00Z",
        )
        session.add(approval)
        await session.commit()
        return sr.id, doc.id, user.id


@pytest.mark.asyncio(loop_scope="session")
async def test_review_history_pending_returns_in_review(client: AsyncClient):
    sr_id, _, _ = await _seed(action="approve_doc", status="pending_doc_review", with_proposal=False)
    res = await client.get(f"/api/sr/drafts/{sr_id}/review-history")
    assert res.status_code == 200
    assert res.json()["status"] == "in_review"


@pytest.mark.asyncio(loop_scope="session")
async def test_review_history_edit_and_approve_full_payload(client: AsyncClient):
    sr_id, doc_id, user_id = await _seed(action="edit_and_approve", status="done_synced")
    res = await client.get(f"/api/sr/drafts/{sr_id}/review-history")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "done_synced"
    assert body["action"] == "edit_and_approve"
    assert body["comment"] == "검토 코멘트"
    assert body["edited_content"] == "최종 적용 본문"
    assert body["reviewer_id"] == str(user_id)
    assert body["reviewer_name"] == "검토자A"
    assert body["selected_doc_mode"] == "existing"
    assert body["selected_document_id"] == str(doc_id)
    assert body["selected_document_title"] == "대상 문서"
    assert body["final_proposal"]["proposed_content"] == "최종 적용 본문"
    assert body["final_proposal"]["original_content"] == "원본 본문"
    assert body["ai_recommendation"]["recommendation"] == "existing"


@pytest.mark.asyncio(loop_scope="session")
async def test_review_history_reject_no_proposal(client: AsyncClient):
    sr_id, _, _ = await _seed(action="reject", status="done_no_proposal", with_proposal=False)
    res = await client.get(f"/api/sr/drafts/{sr_id}/review-history")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "done_no_proposal"
    assert body["action"] == "reject"
    assert body["comment"] == "검토 코멘트"
    assert body["final_proposal"] is None
    assert body["selected_doc_mode"] == "none"


@pytest.mark.asyncio(loop_scope="session")
async def test_review_history_not_found(client: AsyncClient):
    fake = uuid.uuid4()
    res = await client.get(f"/api/sr/drafts/{fake}/review-history")
    assert res.status_code == 404
