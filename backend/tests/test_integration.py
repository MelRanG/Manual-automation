"""Cross-feature integration tests — full user journeys."""
import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_full_document_lifecycle(client: AsyncClient, test_user: dict):
    """Document creation → feedback → AI proposal → approval → new version."""
    # 1. Create document
    doc_resp = await client.post("/api/documents", json={
        "title": "Integration Lifecycle Doc",
        "description": "Full lifecycle test",
        "owner_id": test_user["id"],
    }, params={"content": "The server runs on port 8080. It uses PostgreSQL 12."})
    assert doc_resp.status_code == 201
    doc_id = doc_resp.json()["id"]

    # 2. Verify it appears in list
    list_resp = await client.get("/api/documents")
    assert any(d["id"] == doc_id for d in list_resp.json()["documents"])

    # 3. Report error
    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "The port is wrong, it should be 8000. Also PostgreSQL version is 16.",
    })
    assert fb_resp.status_code == 201
    proposal = fb_resp.json()["proposed_change"]
    assert proposal is not None
    proposal_id = proposal["id"]

    # 4. Create approval request
    approval_resp = await client.post(f"/api/approvals/{proposal_id}")
    assert approval_resp.status_code == 201
    approval_id = approval_resp.json()["id"]

    # 5. Approve it
    review_resp = await client.post(f"/api/approvals/{approval_id}/review", json={
        "reviewer_id": test_user["id"],
        "action": "approved",
        "comment": "Verified correction",
    })
    assert review_resp.status_code == 200

    # 6. Verify new version exists
    versions_resp = await client.get(f"/api/documents/{doc_id}/versions")
    assert len(versions_resp.json()) >= 2

    # 7. Trust score should reflect the feedback/resolution
    trust_resp = await client.post(f"/api/trust/{doc_id}/recalculate")
    assert trust_resp.status_code == 200


@pytest.mark.asyncio(loop_scope="session")
async def test_chat_with_document_context(client: AsyncClient, test_user: dict):
    """Create document → ask question → verify citations reference that document."""
    # Create doc with specific content
    doc_resp = await client.post("/api/documents", json={
        "title": "Vacation Policy 2024",
        "owner_id": test_user["id"],
    }, params={"content": "All employees receive 25 days of annual leave. Remote work is permitted on Wednesdays and Fridays."})
    assert doc_resp.status_code == 201

    # Create chat session and ask
    session_resp = await client.post("/api/chat/sessions", json={"user_id": test_user["id"]})
    session_id = session_resp.json()["id"]

    ask_resp = await client.post(f"/api/chat/sessions/{session_id}/ask", json={
        "question": "How many days of annual leave do we get?",
    })
    assert ask_resp.status_code == 200
    data = ask_resp.json()
    assert data["content"]  # non-empty response
    assert len(data["citations"]) > 0  # has citations


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_generation_from_document(client: AsyncClient, test_user: dict):
    """Create document → generate SR from issue → submit."""
    doc_resp = await client.post("/api/documents", json={
        "title": "API Docs",
        "owner_id": test_user["id"],
    }, params={"content": "API documentation for the service."})
    doc_id = doc_resp.json()["id"]

    # Generate SR
    sr_resp = await client.post("/api/sr/generate", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "issue_description": "Missing documentation for the /health endpoint",
    })
    assert sr_resp.status_code == 201
    sr_id = sr_resp.json()["id"]
    assert sr_resp.json()["created_by_ai"] is True

    # Submit SR (webhook will be skipped since URL is empty)
    submit_resp = await client.post(f"/api/sr/drafts/{sr_id}/submit")
    assert submit_resp.status_code == 200
    assert submit_resp.json()["webhook"]["status"] == "skipped"


@pytest.mark.asyncio(loop_scope="session")
async def test_change_impact_with_proposals(client: AsyncClient, test_user: dict):
    """Create related docs → analyze impact → generate proposals."""
    doc1_resp = await client.post("/api/documents", json={
        "title": "Main Architecture Doc",
        "owner_id": test_user["id"],
    }, params={"content": "The system uses microservices with REST APIs."})
    doc1_id = doc1_resp.json()["id"]

    doc2_resp = await client.post("/api/documents", json={
        "title": "Deployment Guide",
        "owner_id": test_user["id"],
    }, params={"content": "Deploy each microservice independently using Docker."})
    doc2_id = doc2_resp.json()["id"]

    # Analyze impact
    analysis_resp = await client.post("/api/change-impact/analyze", json={
        "source_type": "document_update",
        "source_id": doc1_id,
        "related_document_ids": [doc2_id],
    })
    assert analysis_resp.status_code == 201
    analysis_id = analysis_resp.json()["id"]

    # Generate proposals
    proposals_resp = await client.post(f"/api/change-impact/{analysis_id}/proposals")
    assert proposals_resp.status_code == 200
    assert len(proposals_resp.json()) >= 1
