import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.jira import JiraConfig
from app.models.sr import SRDraft


@pytest.mark.asyncio(loop_scope="session")
async def test_comment_webhook_triggers_manual_job(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
):
    sr_id = uuid.uuid4()
    issue_key = f"DEMO-{uuid.uuid4().hex[:6]}"
    sr = SRDraft(
        id=sr_id,
        user_id=uuid.UUID(test_user["id"]),
        title="저장 버튼",
        description="저장 안됨",
        priority="medium",
        target_url="https://app.example.com/before",
        jira_issue_key=issue_key,
        status="jira_created",
    )
    config = JiraConfig(
        id=uuid.uuid4(),
        base_url="https://example.atlassian.net",
        site_url="https://example.atlassian.net",
        user_email="me@x.com",
        api_token="t",
        project_key="DEMO",
        is_active=True,
    )
    db_session.add_all([sr, config])
    await db_session.commit()

    payload = {
        "webhookEvent": "comment_created",
        "issue": {"key": issue_key},
        "comment": {
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": "updated: https://app.example.com/after",
                            }
                        ],
                    }
                ],
            }
        },
    }

    fake_steps = ["페이지 진입", "저장 버튼 클릭"]
    fake_job = type("J", (), {"id": uuid.uuid4()})()

    with patch(
        "app.services.manual_service.generate_scenario_steps",
        new=AsyncMock(return_value=fake_steps),
    ), patch(
        "app.services.manual_service.create_job",
        new=AsyncMock(return_value=fake_job),
    ) as mock_create_job, patch(
        "app.services.jira_service._schedule_run_generation",
    ) as mock_schedule:
        resp = await client.post("/api/jira/webhook", json=payload)

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "started"
    assert body["after_url"] == "https://app.example.com/after"
    mock_create_job.assert_called_once()
    kwargs = mock_create_job.call_args.kwargs
    assert kwargs["target_url"] == "https://app.example.com/after"
    assert kwargs["scenario_steps"] == fake_steps
    assert kwargs["source_sr_id"] == sr_id
    mock_schedule.assert_called_once()


@pytest.mark.asyncio(loop_scope="session")
async def test_comment_webhook_no_url_skips(
    client: AsyncClient, db_session: AsyncSession, test_user: dict
):
    sr_id = uuid.uuid4()
    issue_key = f"DEMO-{uuid.uuid4().hex[:6]}"
    sr = SRDraft(
        id=sr_id,
        user_id=uuid.UUID(test_user["id"]),
        title="t",
        description="d",
        priority="medium",
        jira_issue_key=issue_key,
        status="jira_created",
    )
    db_session.add(sr)
    await db_session.commit()

    payload = {
        "webhookEvent": "comment_created",
        "issue": {"key": issue_key},
        "comment": {"body": "URL 없음 그냥 코멘트"},
    }
    with patch(
        "app.services.manual_service.create_job",
        new=AsyncMock(),
    ) as mock_create_job:
        resp = await client.post("/api/jira/webhook", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "skipped"
    mock_create_job.assert_not_called()
