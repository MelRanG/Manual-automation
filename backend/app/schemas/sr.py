import uuid
from datetime import datetime

from pydantic import BaseModel


class SRDraftCreate(BaseModel):
    user_id: uuid.UUID
    title: str
    description: str
    priority: str = "medium"
    related_document_ids: list[uuid.UUID] | None = None


class SRDraftResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    description: str
    priority: str
    related_document_ids: list[uuid.UUID] | None
    status: str
    created_by_ai: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SRGenerateRequest(BaseModel):
    user_id: uuid.UUID
    document_id: uuid.UUID
    issue_description: str


class WebhookDeliveryResponse(BaseModel):
    id: uuid.UUID
    sr_draft_id: uuid.UUID
    target_url: str
    response_status: int | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
