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
    assert any(a["id"] == approval_id for a in list_resp.json()["items"])

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


@pytest.mark.asyncio(loop_scope="session")
async def test_proposed_change_has_source_type(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Source Type Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original text."})
    doc_id = doc_resp.json()["id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "This content needs updating",
    })
    assert fb_resp.status_code == 201
    proposed = fb_resp.json()["proposed_change"]
    assert proposed is not None
    assert proposed["source_type"] == "feedback"


@pytest.mark.asyncio(loop_scope="session")
async def test_list_approvals_includes_proposed_change(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Include Proposed Change Test",
        "owner_id": test_user["id"],
    }, params={"content": "Some content to correct."})
    doc_id = doc_resp.json()["id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "This needs correction",
    })
    proposal_id = fb_resp.json()["proposed_change"]["id"]
    await client.post(f"/api/approvals/{proposal_id}")

    list_resp = await client.get("/api/approvals")
    assert list_resp.status_code == 200
    approvals = list_resp.json()["items"]
    assert len(approvals) > 0
    target = next((a for a in approvals if a["proposed_change_id"] == proposal_id), None)
    assert target is not None
    assert target["proposed_change"] is not None
    assert target["proposed_change"]["source_type"] == "feedback"
    assert "original_text" in target["proposed_change"]
    assert "proposed_text" in target["proposed_change"]
    assert "confidence" in target["proposed_change"]


@pytest.mark.asyncio(loop_scope="session")
async def test_playwright_manual_approval_flow(client: AsyncClient, test_user: dict):
    # ManualJob 생성 (백그라운드 실행 없이 직접 서비스 호출)
    from app.db import SessionLocal
    from app.services import manual_service

    async with SessionLocal() as db:
        job = await manual_service.create_job(
            db,
            user_id=test_user["id"],
            target_url="https://example.com",
        )
        job_id = job.id
        await manual_service.run_generation(db, job_id)

    # job 상태 확인
    job_resp = await client.get(f"/api/manuals/jobs/{job_id}")
    assert job_resp.status_code == 200
    job_data = job_resp.json()
    # 승인 전이므로 output_document_id가 None
    assert job_data["output_document_id"] is None
    assert job_data["status"] == "completed"

    # Approvals 목록에서 playwright 수정안 확인
    list_resp = await client.get("/api/approvals")
    approvals = list_resp.json()["items"]
    playwright_approval = next(
        (a for a in approvals
         if a["proposed_change"] and a["proposed_change"]["source_type"] == "playwright"),
        None
    )
    assert playwright_approval is not None
    approval_id = playwright_approval["id"]

    # 승인
    review_resp = await client.post(f"/api/approvals/{approval_id}/review", json={
        "reviewer_id": test_user["id"],
        "action": "approved",
    })
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "approved"

    # 승인 후 job의 output_document_id가 설정됐는지 확인
    job_resp2 = await client.get(f"/api/manuals/jobs/{job_id}")
    assert job_resp2.json()["output_document_id"] is not None


@pytest.mark.asyncio(loop_scope="session")
async def test_list_approvals_pagination(client: AsyncClient, test_user: dict):
    # 응답이 { items, total } 형태인지 확인
    resp = await client.get("/api/approvals?status=all&skip=0&limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert isinstance(data["items"], list)
    assert isinstance(data["total"], int)
    assert len(data["items"]) <= 5


@pytest.mark.asyncio(loop_scope="session")
async def test_list_approvals_status_processing(client: AsyncClient, test_user: dict):
    # processing = pending + needs_review
    resp = await client.get("/api/approvals?status=processing")
    assert resp.status_code == 200
    data = resp.json()
    for item in data["items"]:
        assert item["status"] in ("pending", "needs_review")


@pytest.mark.asyncio(loop_scope="session")
async def test_list_approvals_status_completed(client: AsyncClient, test_user: dict):
    # completed = approved + rejected
    resp = await client.get("/api/approvals?status=completed")
    assert resp.status_code == 200
    data = resp.json()
    for item in data["items"]:
        assert item["status"] in ("approved", "rejected")
