import uuid
from datetime import datetime

from pydantic import BaseModel


class DocumentCreate(BaseModel):
    title: str
    description: str | None = None
    owner_id: uuid.UUID | None = None
    priority: str = "medium"
    document_type: str | None = None
    domain: str | None = None
    audience: str | None = None
    source_type: str | None = None
    related_sr_id: uuid.UUID | None = None
    jira_issue_key: str | None = None
    tags: list[str] | None = None


class DocumentUpdate(BaseModel):
    """부분 업데이트 스키마. None 필드는 변경하지 않음."""
    title: str | None = None
    description: str | None = None
    content: str | None = None
    change_summary: str | None = None
    document_type: str | None = None
    domain: str | None = None
    audience: str | None = None
    source_type: str | None = None
    related_sr_id: uuid.UUID | None = None
    jira_issue_key: str | None = None
    tags: list[str] | None = None


class DocumentVersionResponse(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    version_number: int
    content: str
    source_file_url: str | None
    change_summary: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    owner_id: uuid.UUID | None
    status: str
    priority: str
    trust_score: float
    view_count: int
    created_at: datetime
    updated_at: datetime
    current_version_id: uuid.UUID | None
    document_type: str | None = None
    domain: str | None = None
    audience: str | None = None
    source_type: str | None = None
    source_file_url: str | None = None
    related_sr_id: uuid.UUID | None = None
    jira_issue_key: str | None = None
    tags: list[str] | None = None

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]
    total: int
