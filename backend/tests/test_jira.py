import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.services import jira_service
from app.models.jira import JiraConfig


def make_config():
    cfg = JiraConfig()
    cfg.base_url = "https://test.atlassian.net"
    cfg.user_email = "test@example.com"
    cfg.api_token = "token123"
    cfg.project_key = "TEST"
    cfg.is_active = True
    cfg.trigger_status_names = None
    return cfg


def test_is_done_status_category():
    cfg = make_config()
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "완료됨",
                    "statusCategory": {"key": "done"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is True


def test_is_done_custom_status_names_match():
    cfg = make_config()
    cfg.trigger_status_names = ["배포됨", "Done"]
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "배포됨",
                    "statusCategory": {"key": "indeterminate"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is True


def test_is_done_custom_status_names_no_match():
    cfg = make_config()
    cfg.trigger_status_names = ["Done"]
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "In Progress",
                    "statusCategory": {"key": "indeterminate"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is False


def test_mask_token():
    assert jira_service.mask_token("abcdefgh") == "****efgh"
    assert jira_service.mask_token("ab") == "****"


@pytest.mark.asyncio(loop_scope="session")
async def test_webhook_skipped_no_config(client):
    payload = {
        "webhookEvent": "jira:issue_updated",
        "issue": {
            "key": "TEST-999",
            "fields": {
                "status": {
                    "name": "Done",
                    "statusCategory": {"key": "done"},
                }
            },
        },
    }
    resp = await client.post("/api/jira/webhook", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "skipped"
