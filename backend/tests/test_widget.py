import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_create_widget_session_anonymous(client: AsyncClient):
    resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["site_id"] == "test_site"
    assert "id" in data


@pytest.mark.asyncio(loop_scope="session")
async def test_create_widget_session_with_user_id(client: AsyncClient, test_user: dict):
    resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
        "user_id": test_user["id"],
    })
    assert resp.status_code == 201
