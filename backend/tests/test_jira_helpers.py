import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services import jira_service
from app.services.jira_service import (
    build_jira_issue_url,
    derive_base_url,
    normalize_site_url,
)


def test_normalize_site_url_strips_trailing_slash():
    assert normalize_site_url("https://x.atlassian.net/") == "https://x.atlassian.net"


def test_normalize_site_url_keeps_no_trailing_slash():
    assert normalize_site_url("https://x.atlassian.net") == "https://x.atlassian.net"


def test_normalize_site_url_adds_https_when_missing_scheme():
    assert normalize_site_url("x.atlassian.net") == "https://x.atlassian.net"


def test_normalize_site_url_forces_https_from_http():
    assert normalize_site_url("http://x.atlassian.net") == "https://x.atlassian.net"


def test_normalize_site_url_strips_whitespace():
    assert normalize_site_url("  https://x.atlassian.net  ") == "https://x.atlassian.net"


def test_derive_base_url():
    assert (
        derive_base_url("7b4ffc68-2983-46cb-b50f-5f2ef43a6a57")
        == "https://api.atlassian.com/ex/jira/7b4ffc68-2983-46cb-b50f-5f2ef43a6a57"
    )


def test_normalize_site_url_uppercase_https_scheme():
    assert normalize_site_url("HTTPS://x.atlassian.net") == "HTTPS://x.atlassian.net"


def test_normalize_site_url_uppercase_http_scheme_forces_https():
    assert normalize_site_url("HTTP://x.atlassian.net") == "https://x.atlassian.net"


def _config(site_url):
    return SimpleNamespace(site_url=site_url)


def test_build_jira_issue_url_normal():
    assert (
        build_jira_issue_url("SCRUM-178", _config("https://x.atlassian.net"))
        == "https://x.atlassian.net/browse/SCRUM-178"
    )


def test_build_jira_issue_url_strips_trailing_slash():
    assert (
        build_jira_issue_url("SCRUM-1", _config("https://x.atlassian.net/"))
        == "https://x.atlassian.net/browse/SCRUM-1"
    )


def test_build_jira_issue_url_none_when_key_missing():
    assert build_jira_issue_url(None, _config("https://x.atlassian.net")) is None


def test_build_jira_issue_url_none_when_config_missing():
    assert build_jira_issue_url("SCRUM-1", None) is None


def test_build_jira_issue_url_none_when_site_url_missing():
    assert build_jira_issue_url("SCRUM-1", _config(None)) is None


def test_build_jira_issue_url_none_for_local_key():
    assert (
        build_jira_issue_url("LOCAL-ABCD1234", _config("https://x.atlassian.net"))
        is None
    )


@pytest.mark.asyncio(loop_scope="session")
async def test_resolve_cloud_id_success():
    with patch.object(
        jira_service,
        "_fetch_tenant_info",
        AsyncMock(return_value={"cloudId": "abc-123", "cloudName": "x"}),
    ):
        assert await jira_service.resolve_cloud_id("https://x.atlassian.net") == "abc-123"


@pytest.mark.asyncio(loop_scope="session")
async def test_resolve_cloud_id_missing_field():
    with patch.object(
        jira_service,
        "_fetch_tenant_info",
        AsyncMock(return_value={"cloudName": "x"}),
    ):
        with pytest.raises(ValueError, match="cloudId"):
            await jira_service.resolve_cloud_id("https://x.atlassian.net")


@pytest.mark.asyncio(loop_scope="session")
async def test_resolve_cloud_id_http_error():
    with patch.object(
        jira_service,
        "_fetch_tenant_info",
        AsyncMock(side_effect=RuntimeError("HTTP 404")),
    ):
        with pytest.raises(ValueError, match="tenant_info"):
            await jira_service.resolve_cloud_id("https://x.atlassian.net")


@pytest.mark.asyncio(loop_scope="session")
async def test_resolve_cloud_id_normalizes_input():
    captured = {}

    async def fake(site_url):
        captured["site_url"] = site_url
        return {"cloudId": "abc-123"}

    with patch.object(jira_service, "_fetch_tenant_info", AsyncMock(side_effect=fake)):
        await jira_service.resolve_cloud_id("x.atlassian.net/")

    assert captured["site_url"] == "https://x.atlassian.net"
