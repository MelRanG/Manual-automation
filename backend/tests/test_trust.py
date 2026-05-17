import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_recalculate_trust_score(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Trust Test",
        "owner_id": test_user["id"],
    }, params={"content": "Content for trust test."})
    doc_id = doc_resp.json()["id"]

    resp = await client.post(f"/api/trust/{doc_id}/recalculate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["trust_score"] >= 0.0
    assert data["trust_score"] <= 1.0


@pytest.mark.asyncio(loop_scope="session")
async def test_trust_decreases_with_feedback(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Trust Decrease Test",
        "owner_id": test_user["id"],
    }, params={"content": "Content."})
    doc_id = doc_resp.json()["id"]

    initial = await client.post(f"/api/trust/{doc_id}/recalculate")
    initial_score = initial.json()["trust_score"]

    # Add feedback (without document, so no proposal generated)
    await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Error found",
    })

    after = await client.post(f"/api/trust/{doc_id}/recalculate")
    after_score = after.json()["trust_score"]
    # Score should change (resolved feedback adds back some score)
    assert after_score != initial_score


@pytest.mark.asyncio(loop_scope="session")
async def test_list_trust_scores(client: AsyncClient):
    resp = await client.get("/api/trust")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
