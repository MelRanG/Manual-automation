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


def test_widget_session_create_accepts_user_id():
    from app.schemas.widget import WidgetSessionCreate
    m = WidgetSessionCreate(site_id="s", user_id="00000000-0000-0000-0000-000000000001")
    assert str(m.user_id) == "00000000-0000-0000-0000-000000000001"


def test_widget_session_create_rejects_non_uuid_user_id():
    import pytest
    from pydantic import ValidationError
    from app.schemas.widget import WidgetSessionCreate
    with pytest.raises(ValidationError):
        WidgetSessionCreate(site_id="s", user_id="not-a-uuid")
