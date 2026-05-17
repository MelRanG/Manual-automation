import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_full_approval_workflow(client: AsyncClient, test_user: dict):
    # Create document
    doc_resp = await client.post("/api/documents", json={
        "title": "Approval Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original content here."})
    doc_id = doc_resp.json()["id"]

    # Report feedback -> generates proposal
    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Content is outdated, needs updating",
    })
    proposal_id = fb_resp.json()["proposed_change"]["id"]

    # Create approval request
    approval_resp = await client.post(f"/api/approvals/{proposal_id}")
    assert approval_resp.status_code == 201
    approval_id = approval_resp.json()["id"]
    assert approval_resp.json()["status"] == "pending"

    # List pending approvals
    list_resp = await client.get("/api/approvals")
    assert list_resp.status_code == 200
    assert any(a["id"] == approval_id for a in list_resp.json())

    # Approve it
    review_resp = await client.post(f"/api/approvals/{approval_id}/review", json={
        "reviewer_id": test_user["id"],
        "action": "approved",
        "comment": "Looks good",
    })
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "approved"

    # Verify new version was created
    versions_resp = await client.get(f"/api/documents/{doc_id}/versions")
    versions = versions_resp.json()
    assert len(versions) >= 2


@pytest.mark.asyncio(loop_scope="session")
async def test_reject_approval(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Reject Test",
        "owner_id": test_user["id"],
    }, params={"content": "Original."})
    doc_id = doc_resp.json()["id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Typo in paragraph 3",
    })
    proposal_id = fb_resp.json()["proposed_change"]["id"]

    approval_resp = await client.post(f"/api/approvals/{proposal_id}")
    approval_id = approval_resp.json()["id"]

    review_resp = await client.post(f"/api/approvals/{approval_id}/review", json={
        "reviewer_id": test_user["id"],
        "action": "rejected",
        "comment": "Not accurate",
    })
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "rejected"


@pytest.mark.asyncio(loop_scope="session")
async def test_duplicate_approval_request(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Dup Test",
        "owner_id": test_user["id"],
    }, params={"content": "Text."})
    doc_id = doc_resp.json()["id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Error here",
    })
    proposal_id = fb_resp.json()["proposed_change"]["id"]

    await client.post(f"/api/approvals/{proposal_id}")
    dup_resp = await client.post(f"/api/approvals/{proposal_id}")
    assert dup_resp.status_code == 409
