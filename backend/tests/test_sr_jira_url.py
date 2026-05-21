import uuid
import pytest
from sqlalchemy import update

from app.models.jira import JiraConfig
from app.models.sr import SRDraft


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_list_response_uses_site_url(client, db_session):
    # Deactivate any pre-existing active configs so ours is the only active one
    await db_session.execute(update(JiraConfig).values(is_active=False))
    await db_session.commit()

    # Seed an active config with a site_url
    cfg = JiraConfig(
        id=uuid.uuid4(),
        site_url="https://manual-automation.atlassian.net",
        base_url="https://api.atlassian.com/ex/jira/cid-xyz",
        user_email="svc@example.com",
        api_token="tok",
        project_key="SCRUM",
        is_active=True,
    )
    db_session.add(cfg)

    # Seed an SR with a stale wrong URL on the DB column
    resp = await client.post(
        "/api/users",
        json={"name": "U", "email": f"u_{uuid.uuid4().hex[:8]}@e.com", "role": "editor"},
    )
    user_id = uuid.UUID(resp.json()["id"])

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title="t",
        description="d",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        jira_issue_key="SCRUM-178",
        jira_issue_url="https://api.atlassian.com/ex/jira/cid-xyz/browse/SCRUM-178",
    )
    db_session.add(sr)
    await db_session.commit()

    list_resp = await client.get(f"/api/sr/drafts?user_id={user_id}")
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["jira_issue_key"] == "SCRUM-178"
    assert items[0]["jira_issue_url"] == "https://manual-automation.atlassian.net/browse/SCRUM-178"


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_list_response_local_key_yields_none_url(client, db_session):
    # Deactivate pre-existing active configs
    await db_session.execute(update(JiraConfig).values(is_active=False))
    await db_session.commit()

    cfg = JiraConfig(
        id=uuid.uuid4(),
        site_url="https://manual-automation.atlassian.net",
        base_url="https://api.atlassian.com/ex/jira/cid-xyz",
        user_email="svc@example.com",
        api_token="tok",
        project_key="SCRUM",
        is_active=True,
    )
    db_session.add(cfg)

    resp = await client.post(
        "/api/users",
        json={"name": "U", "email": f"u_{uuid.uuid4().hex[:8]}@e.com", "role": "editor"},
    )
    user_id = uuid.UUID(resp.json()["id"])

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title="t",
        description="d",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        jira_issue_key="LOCAL-DEADBEEF",
        jira_issue_url=None,
    )
    db_session.add(sr)
    await db_session.commit()

    list_resp = await client.get(f"/api/sr/drafts?user_id={user_id}")
    items = list_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["jira_issue_url"] is None
