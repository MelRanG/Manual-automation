import pytest

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
