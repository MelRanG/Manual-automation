import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import ApprovalRequest, ProposedDocumentChange
from app.models.manual import ManualGenerationJob


@pytest.mark.asyncio(loop_scope="session")
async def test_manual_jobs_response_embeds_approval(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
):
    # 1) ManualGenerationJob 직접 insert (background generation 우회)
    job_id = uuid.uuid4()
    db_session.add(
        ManualGenerationJob(
            id=job_id,
            user_id=uuid.UUID(test_user["id"]),
            target_url="https://example.com/embed-test",
            status="completed",
        )
    )
    # 2) 연결된 ProposedDocumentChange + ApprovalRequest insert
    change_id = uuid.uuid4()
    db_session.add(
        ProposedDocumentChange(
            id=change_id,
            manual_job_id=job_id,
            original_text="",
            proposed_text="# 임베드 테스트 매뉴얼",
            diff="# 임베드 테스트 매뉴얼",
            reasoning="Playwright auto-generated manual for https://example.com/embed-test",
            confidence=1.0,
            source_type="playwright",
            status="pending",
        )
    )
    approval_id = uuid.uuid4()
    db_session.add(
        ApprovalRequest(
            id=approval_id,
            proposed_change_id=change_id,
            status="pending",
        )
    )
    await db_session.commit()

    # 3) API 응답 확인
    resp = await client.get(f"/api/manuals/jobs/{job_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["proposed_change"] is not None
    assert body["proposed_change"]["id"] == str(change_id)
    assert body["proposed_change"]["proposed_text"] == "# 임베드 테스트 매뉴얼"
    assert body["proposed_change"]["source_type"] == "playwright"
    assert body["approval"] is not None
    assert body["approval"]["id"] == str(approval_id)
    assert body["approval"]["status"] == "pending"


@pytest.mark.asyncio(loop_scope="session")
async def test_manual_jobs_response_no_approval(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
):
    # change/approval 없는 running 상태 job
    job_id = uuid.uuid4()
    db_session.add(
        ManualGenerationJob(
            id=job_id,
            user_id=uuid.UUID(test_user["id"]),
            target_url="https://example.com/no-embed",
            status="running",
        )
    )
    await db_session.commit()

    resp = await client.get(f"/api/manuals/jobs/{job_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["proposed_change"] is None
    assert body["approval"] is None


@pytest.mark.asyncio(loop_scope="session")
async def test_list_manual_jobs_includes_embed(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
):
    job_id = uuid.uuid4()
    db_session.add(
        ManualGenerationJob(
            id=job_id,
            user_id=uuid.UUID(test_user["id"]),
            target_url="https://example.com/list-embed",
            status="completed",
        )
    )
    change_id = uuid.uuid4()
    db_session.add(
        ProposedDocumentChange(
            id=change_id,
            manual_job_id=job_id,
            original_text="",
            proposed_text="list embed",
            diff="list embed",
            reasoning="list embed reason",
            confidence=1.0,
            source_type="playwright",
            status="pending",
        )
    )
    approval_id = uuid.uuid4()
    db_session.add(
        ApprovalRequest(
            id=approval_id,
            proposed_change_id=change_id,
            status="pending",
        )
    )
    await db_session.commit()

    resp = await client.get(f"/api/manuals/jobs?user_id={test_user['id']}")
    assert resp.status_code == 200
    items = resp.json()
    target = next((j for j in items if j["id"] == str(job_id)), None)
    assert target is not None
    assert target["proposed_change"] is not None
    assert target["proposed_change"]["id"] == str(change_id)
    assert target["approval"] is not None
    assert target["approval"]["id"] == str(approval_id)
    assert target["approval"]["status"] == "pending"
