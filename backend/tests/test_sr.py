import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_create_sr_draft(client: AsyncClient, test_user: dict):
    resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Fix login page docs",
        "description": "The login page documentation is outdated",
        "priority": "high",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Fix login page docs"
    assert data["priority"] == "high"
    assert data["created_by_ai"] is False


@pytest.mark.asyncio(loop_scope="session")
async def test_generate_sr_draft(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "SR Gen Doc",
        "owner_id": test_user["id"],
    }, params={"content": "System documentation content."})
    doc_id = doc_resp.json()["id"]

    resp = await client.post("/api/sr/generate", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "issue_description": "Missing API endpoint documentation for /users",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["created_by_ai"] is True
    assert data["status"] == "draft"


@pytest.mark.asyncio(loop_scope="session")
async def test_submit_sr_no_webhook(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Submit Test",
        "description": "Testing submission",
        "priority": "low",
    })
    sr_id = create_resp.json()["id"]

    resp = await client.post(f"/api/sr/drafts/{sr_id}/submit")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "submitted"
    assert data["webhook"]["status"] == "skipped"


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts(client: AsyncClient, test_user: dict):
    await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "List Test",
        "description": "For listing",
        "priority": "low",
    })
    resp = await client.get("/api/sr/drafts", params={"user_id": test_user["id"]})
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


@pytest.mark.asyncio(loop_scope="session")
async def test_update_sr_draft(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Original Title",
        "description": "Original description",
        "priority": "low",
    })
    sr_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/sr/drafts/{sr_id}", json={
        "title": "Updated Title",
        "priority": "high",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Updated Title"
    assert data["priority"] == "high"
    assert data["description"] == "Original description"


@pytest.mark.asyncio(loop_scope="session")
async def test_update_submitted_sr_fails(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "To Submit",
        "description": "desc",
        "priority": "low",
    })
    sr_id = create_resp.json()["id"]
    await client.post(f"/api/sr/drafts/{sr_id}/submit")

    resp = await client.patch(f"/api/sr/drafts/{sr_id}", json={"title": "New Title"})
    assert resp.status_code == 400
