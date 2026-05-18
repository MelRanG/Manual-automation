import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_create_feedback_with_proposal(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Policy Doc",
        "owner_id": test_user["id"],
    }, params={"content": "The company was founded in 2019. We have 100 employees."})
    doc_id = doc_resp.json()["id"]

    resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "The founding year is wrong, it should be 2020",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["feedback"]["status"] == "processed"
    assert data["proposed_change"] is not None
    assert data["proposed_change"]["status"] == "pending"
    assert data["proposed_change"]["confidence"] > 0


@pytest.mark.asyncio(loop_scope="session")
async def test_create_feedback_without_document(client: AsyncClient, test_user: dict):
    resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "General feedback about the system",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["feedback"]["status"] == "pending"
    assert data["proposed_change"] is None


@pytest.mark.asyncio(loop_scope="session")
async def test_list_feedback(client: AsyncClient, test_user: dict):
    await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "Another feedback",
    })
    resp = await client.get("/api/feedback")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


@pytest.mark.asyncio(loop_scope="session")
async def test_get_proposal(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Another Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Some content with errors."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Fix the spelling errors",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert resp.status_code == 200
    assert resp.json()["document_id"] == doc_id


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_list_has_proposed_change_status(client: AsyncClient, test_user: dict):
    # 문서 생성 후 피드백 제출 (수정안 자동 생성됨)
    doc_resp = await client.post("/api/documents", json={
        "title": "Status Field Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Some content."})
    doc_id = doc_resp.json()["id"]

    await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "This needs fixing",
    })

    list_resp = await client.get("/api/feedback")
    assert list_resp.status_code == 200
    items = list_resp.json()
    # proposed_change_status 필드가 있어야 함
    assert all("proposed_change_status" in item for item in items)

    # 방금 만든 항목은 proposed_change_status가 "pending"이어야 함
    target = next((i for i in items if i["document_id"] == doc_id), None)
    assert target is not None
    assert target["proposed_change_status"] == "pending"


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_without_document_has_null_proposed_change_status(client: AsyncClient, test_user: dict):
    await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "No document attached",
    })

    list_resp = await client.get("/api/feedback")
    items = list_resp.json()
    no_doc = next((i for i in items if i["document_id"] is None), None)
    assert no_doc is not None
    assert no_doc["proposed_change_status"] is None
