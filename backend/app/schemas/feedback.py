import uuid
from datetime import datetime

from pydantic import BaseModel


class FeedbackReportCreate(BaseModel):
    user_id: uuid.UUID
    document_id: uuid.UUID | None = None
    chunk_id: uuid.UUID | None = None
    chat_message_id: uuid.UUID | None = None
    feedback_text: str


class FeedbackReportResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    document_id: uuid.UUID | None
    chunk_id: uuid.UUID | None
    chat_message_id: uuid.UUID | None
    feedback_text: str
    status: str
    document_title: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ProposedChangeResponse(BaseModel):
    id: uuid.UUID
    feedback_report_id: uuid.UUID | None
    document_id: uuid.UUID | None
    document_version_id: uuid.UUID | None
    original_text: str
    proposed_text: str
    diff: str
    reasoning: str
    confidence: float
    source_type: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FeedbackWithProposalResponse(BaseModel):
    feedback: FeedbackReportResponse
    proposed_change: ProposedChangeResponse | None
