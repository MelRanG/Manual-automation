"""
Status transition guard tests:
  pending_doc_review → done_synced / done_no_proposal must be blocked via PATCH.
"""
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.sr import SRDraft
from app.models.user import User


async def _seed_sr_with_status(session: AsyncSession, status: str) -> uuid.UUID:
    """DB에 직접 유저와 SR을 삽입하고 SR id 반환."""
    user = User(id=uuid.uuid4(), name="t", email=f"{uuid.uuid4()}@t.com", role="admin")
    session.add(user)
    await session.flush()

    draft = SRDraft(
        id=uuid.uuid4(),
        user_id=user.id,
        title="t",
        description="d",
        priority="medium",
        status=status,
    )
    session.add(draft)
    await session.flush()
    return draft.id


@pytest.mark.asyncio(loop_scope="session")
async def test_patch_pending_doc_review_to_done_synced_rejected(
    client: AsyncClient, db_session: AsyncSession
):
    sr_id = await _seed_sr_with_status(db_session, "pending_doc_review")
    await db_session.commit()

    res = await client.patch(f"/api/sr/drafts/{sr_id}", json={"status": "done_synced"})
    assert res.status_code == 400
    assert "Invalid status transition" in res.json()["detail"]


@pytest.mark.asyncio(loop_scope="session")
async def test_patch_pending_doc_review_to_done_no_proposal_rejected(
    client: AsyncClient, db_session: AsyncSession
):
    sr_id = await _seed_sr_with_status(db_session, "pending_doc_review")
    await db_session.commit()

    res = await client.patch(f"/api/sr/drafts/{sr_id}", json={"status": "done_no_proposal"})
    assert res.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_patch_pending_doc_review_self_allowed(
    client: AsyncClient, db_session: AsyncSession
):
    sr_id = await _seed_sr_with_status(db_session, "pending_doc_review")
    await db_session.commit()

    res = await client.patch(f"/api/sr/drafts/{sr_id}", json={"status": "pending_doc_review"})
    assert res.status_code == 200
