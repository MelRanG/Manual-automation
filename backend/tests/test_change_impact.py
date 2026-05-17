import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_analyze_impact(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Impact Source",
        "owner_id": test_user["id"],
    }, params={"content": "Original content."})
    doc_id = doc_resp.json()["id"]

    resp = await client.post("/api/change-impact/analyze", json={
        "source_type": "document_update",
        "source_id": doc_id,
        "related_document_ids": [doc_id],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "completed"
    assert data["recommended_strategy"] in ("update_all", "selective_update", "no_action")
    assert data["confidence"] > 0


@pytest.mark.asyncio(loop_scope="session")
async def test_generate_proposals(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Proposal Target",
        "owner_id": test_user["id"],
    }, params={"content": "Content that may need updates."})
    doc_id = doc_resp.json()["id"]

    analysis_resp = await client.post("/api/change-impact/analyze", json={
        "source_type": "document_update",
        "source_id": doc_id,
        "related_document_ids": [doc_id],
    })
    analysis_id = analysis_resp.json()["id"]

    resp = await client.post(f"/api/change-impact/{analysis_id}/proposals")
    assert resp.status_code == 200
    proposals = resp.json()
    assert len(proposals) >= 1
    assert proposals[0]["status"] == "pending"


@pytest.mark.asyncio(loop_scope="session")
async def test_list_analyses(client: AsyncClient):
    resp = await client.get("/api/change-impact")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
