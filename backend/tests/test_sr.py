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
async def test_submit_sr(client: AsyncClient, test_user: dict):
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
    # Jira config 유무에 따라 경로가 달라짐: jira_created(직접 연동) 또는 submitted(webhook 폴백)
    assert data["status"] in ("jira_created", "submitted")


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
    assert len(resp.json()["items"]) >= 1


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
    submit_resp = await client.post(f"/api/sr/drafts/{sr_id}/submit")
    assert submit_resp.status_code == 200

    resp = await client.patch(f"/api/sr/drafts/{sr_id}", json={"title": "New Title"})
    assert resp.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_status_filter_draft(client: AsyncClient, test_user: dict):
    await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Draft Filter Test",
        "description": "desc",
        "priority": "medium",
    })
    resp = await client.get("/api/sr/drafts", params={"status": "draft"})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert all(item["status"] == "draft" for item in data["items"])


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_status_filter_active(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Active Filter Test",
        "description": "desc",
        "priority": "medium",
    })
    sr_id = create_resp.json()["id"]
    await client.post(f"/api/sr/drafts/{sr_id}/submit")

    resp = await client.get("/api/sr/drafts", params={"status": "active"})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert all(item["status"] in ("submitted", "jira_created", "pending_document_selection") for item in data["items"])


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_status_filter_done(client: AsyncClient, test_user: dict):
    resp = await client.get("/api/sr/drafts", params={"status": "done"})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] == len(data["items"])
    assert all(item["status"] in ("done_synced", "done_no_proposal") for item in data["items"])


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_pagination(client: AsyncClient, test_user: dict):
    resp = await client.get("/api/sr/drafts", params={"skip": 0, "limit": 2})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert len(data["items"]) <= 2


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_total_count(client: AsyncClient, test_user: dict):
    resp_all = await client.get("/api/sr/drafts")
    total = resp_all.json()["total"]
    resp_p1 = await client.get("/api/sr/drafts", params={"skip": 0, "limit": 1})
    assert resp_p1.json()["total"] == total


@pytest.mark.asyncio(loop_scope="session")
async def test_update_sr_status_invalid_transition_returns_400(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Invalid Transition Test",
        "description": "test",
        "priority": "low",
    })
    sr_id = create_resp.json()["id"]

    # draft 상태에서 직접 done_no_proposal로 — 금지
    resp = await client.patch(f"/api/sr/drafts/{sr_id}", json={"status": "done_no_proposal"})
    assert resp.status_code == 400
    assert "transition" in resp.json()["detail"].lower()


@pytest.mark.asyncio(loop_scope="session")
async def test_update_sr_title_in_draft_still_works(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Old Title",
        "description": "test",
        "priority": "low",
    })
    sr_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/sr/drafts/{sr_id}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"


@pytest.mark.asyncio(loop_scope="session")
async def test_pending_doc_review_response_includes_approval_id(client: AsyncClient):
    from app.db import SessionLocal
    from app.models.user import User
    from app.models.sr import SRDraft
    from app.models.feedback import ApprovalRequest

    async with SessionLocal() as session:
        user = User(id=uuid.uuid4(), name="t", email=f"{uuid.uuid4()}@t.com", role="admin")
        session.add(user)
        await session.flush()  # user FK 참조를 위해 먼저 반영
        draft = SRDraft(
            id=uuid.uuid4(), user_id=user.id, title="t", description="d",
            priority="medium", status="pending_doc_review", jira_issue_key="J-X",
        )
        session.add(draft)
        await session.flush()  # sr_draft FK 참조를 위해 먼저 반영
        approval = ApprovalRequest(
            id=uuid.uuid4(),
            approval_type="doc_review",
            sr_draft_id=draft.id,
            status="pending",
        )
        session.add(approval)
        await session.commit()
        sr_id = draft.id
        approval_id = approval.id

    res = await client.get("/api/sr/drafts")
    assert res.status_code == 200
    items = res.json()["items"]
    match = next(i for i in items if i["id"] == str(sr_id))
    assert match["pending_doc_review_approval_id"] == str(approval_id)
