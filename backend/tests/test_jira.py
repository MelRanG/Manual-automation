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


@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_no_related_docs(client, db_session):
    """관련 문서가 없으면 log.status == skipped_no_docs"""
    import uuid
    from unittest.mock import patch
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.services import jira_service

    # 테스트 사용자 생성
    resp = await client.post("/api/users", json={
        "name": "Jira Test User",
        "email": f"jira_test_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    assert resp.status_code == 201
    user_id = uuid.UUID(resp.json()["id"])

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title="테스트 SR",
        description="설명",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        target_url=None,
    )
    db_session.add(sr)
    await db_session.commit()

    log = JiraCallbackLog(
        id=uuid.uuid4(),
        jira_issue_key="TEST-100",
        event_type="jira:issue_updated",
        payload={},
        status="pending",
        sr_draft_id=sr.id,
    )
    db_session.add(log)
    await db_session.commit()

    with patch("app.services.jira_service._find_related_documents", return_value=[]):
        await jira_service.process_jira_done(sr.id, log.id, db=db_session)

    await db_session.refresh(log)
    assert log.status == "skipped_no_docs"
