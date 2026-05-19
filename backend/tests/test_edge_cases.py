"""Edge case and validation tests."""
import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_empty_document_content(client: AsyncClient, test_user: dict):
    """Document with empty content should still create but have no chunks."""
    resp = await client.post("/api/documents", json={
        "title": "Empty Doc",
        "owner_id": test_user["id"],
    }, params={"content": ""})
    assert resp.status_code == 201


@pytest.mark.asyncio(loop_scope="session")
async def test_very_long_document(client: AsyncClient, test_user: dict):
    """Large document should be chunked into multiple pieces."""
    long_content = "\n\n".join([f"Section {i}: " + "x" * 400 for i in range(50)])
    resp = await client.post("/api/documents", json={
        "title": "Long Doc",
        "owner_id": test_user["id"],
    }, params={"content": long_content})
    assert resp.status_code == 201


@pytest.mark.asyncio(loop_scope="session")
async def test_document_without_owner(client: AsyncClient):
    """Document can be created without an owner."""
    resp = await client.post("/api/documents", json={
        "title": "Orphan Doc",
    }, params={"content": "No owner assigned."})
    assert resp.status_code == 201
    assert resp.json()["owner_id"] is None


@pytest.mark.asyncio(loop_scope="session")
async def test_create_version_on_nonexistent_doc(client: AsyncClient):
    """Creating a version on a non-existent document returns 404."""
    fake_id = "00000000-0000-0000-0000-000000000000"
    resp = await client.post(f"/api/documents/{fake_id}/versions", data={
        "content": "v2",
    })
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_approval_double_review(client: AsyncClient, test_user: dict):
    """Reviewing an already-reviewed approval should fail."""
    doc_resp = await client.post("/api/documents", json={
        "title": "Double Review Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Content."})
    doc_id = doc_resp.json()["id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Fix it",
    })
    approval_id = fb_resp.json()["approval_id"]
    assert approval_id is not None

    # First review
    await client.post(f"/api/approvals/{approval_id}/review", json={
        "reviewer_id": test_user["id"],
        "action": "approved",
    })

    # Second review should fail
    resp = await client.post(f"/api/approvals/{approval_id}/review", json={
        "reviewer_id": test_user["id"],
        "action": "rejected",
    })
    assert resp.status_code == 400  # "Approval already reviewed"


@pytest.mark.asyncio(loop_scope="session")
async def test_invalid_approval_action(client: AsyncClient, test_user: dict):
    """Invalid action (not approved/rejected) should return 400."""
    doc_resp = await client.post("/api/documents", json={
        "title": "Invalid Action Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Content."})
    doc_id = doc_resp.json()["id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Fix it",
    })
    approval_id = fb_resp.json()["approval_id"]
    assert approval_id is not None

    resp = await client.post(f"/api/approvals/{approval_id}/review", json={
        "reviewer_id": test_user["id"],
        "action": "maybe",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_chat_session_not_found(client: AsyncClient):
    """Get non-existent session returns 404."""
    resp = await client.get("/api/chat/sessions/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_submit_not_found(client: AsyncClient):
    """Submitting non-existent SR returns 404."""
    resp = await client.post("/api/sr/drafts/00000000-0000-0000-0000-000000000000/submit")
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_proposal_not_found(client: AsyncClient):
    """Getting proposal for non-existent feedback returns 404."""
    resp = await client.get("/api/feedback/00000000-0000-0000-0000-000000000000/proposal")
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_document_pagination(client: AsyncClient, test_user: dict):
    """Pagination works correctly."""
    for i in range(5):
        await client.post("/api/documents", json={
            "title": f"Paginated Doc {i}",
            "owner_id": test_user["id"],
        }, params={"content": f"Content {i}"})

    resp = await client.get("/api/documents", params={"skip": 0, "limit": 2})
    data = resp.json()
    assert len(data["documents"]) == 2
    assert data["total"] >= 5


@pytest.mark.asyncio(loop_scope="session")
async def test_health_endpoint(client: AsyncClient):
    """Health endpoint always returns ok."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
