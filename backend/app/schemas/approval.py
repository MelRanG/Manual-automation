import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.feedback import ProposedChangeResponse


class ApprovalAction(BaseModel):
    reviewer_id: uuid.UUID
    action: str  # "approved", "rejected", "edit_and_approve", "request_review"
    comment: str | None = None
    edited_content: str | None = None


class DocReviewAction(BaseModel):
    reviewer_id: uuid.UUID
    action: Literal["reject", "approve_doc", "approve_manual", "edit_and_approve"]
    target_url: str | None = None
    edited_content: str | None = None
    comment: str | None = None


class ApprovalRequestResponse(BaseModel):
    id: uuid.UUID
    proposed_change_id: uuid.UUID | None
    approval_type: str
    sr_draft_id: uuid.UUID | None
    proposed_change: ProposedChangeResponse | None = None
    reviewer_id: uuid.UUID | None
    status: str
    comment: str | None
    reviewed_at: str | None
    action: str | None = None
    edited_content: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalListResponse(BaseModel):
    items: list[ApprovalRequestResponse]
    total: int
