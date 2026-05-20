import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_create_feedback_no_auto_proposal(client: AsyncClient, test_user: dict):
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
    assert data["feedback"]["status"] == "pending"
    assert data["proposed_change"] is None


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

    draft_resp = await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Fix the spelling errors",
    })
    assert draft_resp.status_code == 200

    resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert resp.status_code == 200
    assert resp.json()["document_id"] == doc_id


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_list_has_proposed_change_status(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Status Field Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Some content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "This needs fixing",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "This needs fixing",
    })

    list_resp = await client.get("/api/feedback")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert all("proposed_change_status" in item for item in items)

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


@pytest.mark.asyncio(loop_scope="session")
async def test_request_draft_uses_reviewed_text(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Draft Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original content here."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Original feedback",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    resp = await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Admin reviewed: the content needs update",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["proposed_change"] is not None
    assert data["feedback"]["reviewed_text"] == "Admin reviewed: the content needs update"


@pytest.mark.asyncio(loop_scope="session")
async def test_request_draft_duplicate_returns_400(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Duplicate Draft Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Some feedback",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "first request",
    })
    resp = await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "second request",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_link_document(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Link Target Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "No document attached",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]
    assert feedback_resp.json()["feedback"]["document_id"] is None

    resp = await client.patch(f"/api/feedback/{feedback_id}/link-document", json={
        "document_id": doc_id,
    })
    assert resp.status_code == 200
    assert resp.json()["document_id"] == doc_id
    assert resp.json()["document_title"] == "Link Target Doc"

    # 이미 연결된 상태에서 재시도 → 400
    resp2 = await client.patch(f"/api/feedback/{feedback_id}/link-document", json={
        "document_id": doc_id,
    })
    assert resp2.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_request_draft_without_document_returns_400(client: AsyncClient, test_user: dict):
    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "No document attached",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    resp = await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "something",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_get_proposal_is_stale_false_when_version_matches(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Stale Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Fix this",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Fix this",
    })

    resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert resp.status_code == 200
    assert resp.json()["is_stale"] is False


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_proposal_resets_feedback_status(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Delete Proposal Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Some content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Needs fixing",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Needs fixing",
    })

    # proposal 존재 확인
    proposal_resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert proposal_resp.status_code == 200

    # 삭제
    del_resp = await client.delete(f"/api/feedback/{feedback_id}/proposal")
    assert del_resp.status_code == 204

    # proposal 사라짐
    after_resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert after_resp.status_code == 404

    # feedback status 리셋
    list_resp = await client.get("/api/feedback")
    target = next(i for i in list_resp.json() if i["id"] == feedback_id)
    assert target["status"] == "pending"
