import uuid
from datetime import datetime

from pydantic import BaseModel


class JiraConfigUpsert(BaseModel):
    site_url: str
    user_email: str
    api_token: str | None = None
    project_key: str
    is_active: bool = True
    trigger_status_names: list[str] | None = None


class JiraConfigResponse(BaseModel):
    id: uuid.UUID
    site_url: str | None = None
    base_url: str  # server-derived (read-only from client perspective)
    user_email: str
    api_token_masked: str  # "****" + 마지막 4자
    project_key: str
    is_active: bool
    trigger_status_names: list[str] | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JiraCallbackLogResponse(BaseModel):
    id: uuid.UUID
    jira_issue_key: str
    event_type: str
    sr_draft_id: uuid.UUID | None
    sr_title: str | None = None
    jira_issue_summary: str | None = None
    jira_issue_status: str | None = None
    jira_issue_status_category: str | None = None
    status: str
    error_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class JiraConnectionTestResult(BaseModel):
    success: bool
    message: str
