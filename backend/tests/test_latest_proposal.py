import uuid

import pytest
from httpx import AsyncClient

from app.models.sr import ChangeImpactAnalysis, DocumentChangeProposal


async def _make_pending_sr(client: AsyncClient, test_user: dict) -> str:
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Latest Proposal Test",
        "description": "test",
        "priority": "low",
    })
    sr_id = create_resp.json()["id"]
    await client.post(f"/api/sr/drafts/{sr_id}/submit")
    await client.post(f"/api/sr/drafts/{sr_id}/complete-local")
    return sr_id


@pytest.mark.asyncio(loop_scope="session")
async def test_latest_proposal_returns_null_when_no_analysis(
    client: AsyncClient, test_user: dict
):
    sr_id = await _make_pending_sr(client, test_user)
    resp = await client.get(f"/api/sr/drafts/{sr_id}/latest-proposal")
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio(loop_scope="session")
async def test_latest_proposal_returns_doc_mode_hint_existing(
    client: AsyncClient, test_user: dict, db_session
):
    sr_id = await _make_pending_sr(client, test_user)
    # 문서 1개 생성
    doc_resp = await client.post("/api/documents", json={
        "title": "Target Doc", "owner_id": test_user["id"],
    }, params={"content": "doc content"})
    doc_id = doc_resp.json()["id"]

    # ChangeImpactAnalysis + DocumentChangeProposal 직접 삽입
    analysis = ChangeImpactAnalysis(
        id=uuid.uuid4(),
        source_type="jira_sr",
        source_id=uuid.UUID(sr_id),
        related_document_ids=[doc_id],
        recommended_strategy="update",
        reasoning="test reasoning",
        confidence=0.9,
        status="pending",
    )
    db_session.add(analysis)
    await db_session.flush()
    proposal = DocumentChangeProposal(
        id=uuid.uuid4(),
        impact_analysis_id=analysis.id,
        document_id=uuid.UUID(doc_id),
        original_content="orig",
        proposed_content="proposed",
        diff="diff",
        status="pending",
    )
    db_session.add(proposal)
    await db_session.commit()

    resp = await client.get(f"/api/sr/drafts/{sr_id}/latest-proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body is not None
    assert body["doc_mode_hint"] == "existing"
    assert body["proposal"]["document_id"] == doc_id


@pytest.mark.asyncio(loop_scope="session")
async def test_latest_proposal_returns_doc_mode_hint_new_when_no_proposal(
    client: AsyncClient, test_user: dict, db_session
):
    sr_id = await _make_pending_sr(client, test_user)
    analysis = ChangeImpactAnalysis(
        id=uuid.uuid4(),
        source_type="jira_sr",
        source_id=uuid.UUID(sr_id),
        related_document_ids=[],
        recommended_strategy="create",
        reasoning="new doc needed",
        confidence=0.7,
        status="pending",
    )
    db_session.add(analysis)
    await db_session.commit()

    resp = await client.get(f"/api/sr/drafts/{sr_id}/latest-proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body is not None
    assert body["doc_mode_hint"] == "new"
    assert body["proposal"] is None


@pytest.mark.asyncio(loop_scope="session")
async def test_latest_proposal_returns_most_recent_when_multiple(
    client: AsyncClient, test_user: dict, db_session
):
    sr_id = await _make_pending_sr(client, test_user)
    older = ChangeImpactAnalysis(
        id=uuid.uuid4(),
        source_type="jira_sr",
        source_id=uuid.UUID(sr_id),
        related_document_ids=[],
        recommended_strategy="create",
        reasoning="older",
        confidence=0.5,
        status="pending",
    )
    db_session.add(older)
    await db_session.commit()
    newer = ChangeImpactAnalysis(
        id=uuid.uuid4(),
        source_type="jira_sr",
        source_id=uuid.UUID(sr_id),
        related_document_ids=[],
        recommended_strategy="create",
        reasoning="newer",
        confidence=0.6,
        status="pending",
    )
    db_session.add(newer)
    await db_session.commit()

    resp = await client.get(f"/api/sr/drafts/{sr_id}/latest-proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body["impact_analysis"]["reasoning"] == "newer"
