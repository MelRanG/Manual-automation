import uuid
from datetime import datetime

from pydantic import BaseModel


class ManualJobCreate(BaseModel):
    user_id: uuid.UUID
    target_url: str
    login_id: str | None = None
    login_pw: str | None = None
    login_url: str | None = None
    scenario_steps: list[str] | None = None
    source_sr_id: uuid.UUID | None = None


class ProposedChangeBrief(BaseModel):
    id: uuid.UUID
    proposed_text: str
    reasoning: str
    confidence: float
    source_type: str
    status: str

    model_config = {"from_attributes": True}


class ApprovalBrief(BaseModel):
    id: uuid.UUID
    status: str
    approval_type: str
    comment: str | None
    reviewer_id: uuid.UUID | None
    reviewed_at: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ManualJobResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    target_url: str
    login_url: str | None
    status: str
    output_document_id: uuid.UUID | None
    screenshots: list[dict] | None
    error_message: str | None
    created_at: datetime
    proposed_change: ProposedChangeBrief | None = None
    approval: ApprovalBrief | None = None

    model_config = {"from_attributes": True}
