import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import ApprovalRequest, ProposedDocumentChange


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_manual_job(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/manuals/jobs", json={
        "user_id": test_user["id"],
        "target_url": "https://example.com",
    })
    assert create_resp.status_code == 201
    job_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/manuals/jobs/{job_id}")
    assert del_resp.status_code == 204

    get_resp = await client.get(f"/api/manuals/jobs/{job_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_unknown_manual_job(client: AsyncClient):
    fake_id = uuid.uuid4()
    resp = await client.delete(f"/api/manuals/jobs/{fake_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_manual_job_cleans_proposed_change_chain(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
):
    create_resp = await client.post("/api/manuals/jobs", json={
        "user_id": test_user["id"],
        "target_url": "https://example.com/chain",
    })
    assert create_resp.status_code == 201
    job_id = create_resp.json()["id"]

    pc = ProposedDocumentChange(
        manual_job_id=uuid.UUID(job_id),
        original_text="o",
        proposed_text="p",
        diff="-o\n+p",
        reasoning="r",
        confidence=0.9,
        source_type="manual",
    )
    db_session.add(pc)
    await db_session.flush()
    pc_id = pc.id

    approval = ApprovalRequest(
        proposed_change_id=pc_id,
        approval_type="document_change",
    )
    db_session.add(approval)
    await db_session.commit()
    approval_id = approval.id

    del_resp = await client.delete(f"/api/manuals/jobs/{job_id}")
    assert del_resp.status_code == 204

    pc_check = await db_session.execute(
        select(ProposedDocumentChange).where(ProposedDocumentChange.id == pc_id)
    )
    assert pc_check.scalar_one_or_none() is None

    appr_check = await db_session.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )
    assert appr_check.scalar_one_or_none() is None
