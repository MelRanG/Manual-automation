import pytest
from unittest.mock import AsyncMock, patch

from app.services import jira_service


@pytest.mark.asyncio(loop_scope="session")
async def test_upsert_config_derives_base_url(client):
    payload = {
        "site_url": "https://manual-automation.atlassian.net",
        "user_email": "svc@example.com",
        "api_token": "tok",
        "project_key": "SCRUM",
        "is_active": True,
        "trigger_status_names": None,
    }
    with patch.object(
        jira_service, "resolve_cloud_id", AsyncMock(return_value="7b4ffc68-CID")
    ):
        resp = await client.put("/api/jira/config", json=payload)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["site_url"] == "https://manual-automation.atlassian.net"
    assert body["base_url"] == "https://api.atlassian.com/ex/jira/7b4ffc68-CID"


@pytest.mark.asyncio(loop_scope="session")
async def test_upsert_config_rejects_invalid_site(client):
    payload = {
        "site_url": "https://broken.atlassian.net",
        "user_email": "svc@example.com",
        "api_token": "tok",
        "project_key": "SCRUM",
        "is_active": True,
        "trigger_status_names": None,
    }
    with patch.object(
        jira_service,
        "resolve_cloud_id",
        AsyncMock(side_effect=ValueError("tenant_info 호출 실패: HTTP 404")),
    ):
        resp = await client.put("/api/jira/config", json=payload)

    assert resp.status_code == 400
    assert "cloudId" in resp.json()["detail"] or "tenant_info" in resp.json()["detail"]
