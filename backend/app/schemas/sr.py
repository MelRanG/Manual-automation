import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SRDraftCreate(BaseModel):
    user_id: uuid.UUID
    title: str
    description: str
    priority: str = "medium"
    related_document_ids: list[uuid.UUID] | None = None
    target_url: str | None = None


class SRDraftResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    description: str
    priority: str
    related_document_ids: list[uuid.UUID] | None
    status: str
    created_by_ai: bool
    jira_issue_key: str | None = None
    jira_issue_url: str | None = None
    target_url: str | None = None
    ai_doc_recommendation: dict[str, Any] | None = None
    pending_doc_review_approval_id: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SRDraftListResponse(BaseModel):
    items: list[SRDraftResponse]
    total: int


class SRDraftUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    status: str | None = None


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


class CompletedSREvent(BaseModel):
    source: str
    event_type: str = "sr_completed"
    external_issue_key: str | None = None
    status: str
    title: str | None = None
    description: str | None = None
    completion_summary: str | None = None
    changed_screen: str | None = None
    changed_user_flow: str | None = None
    raw_payload: dict[str, Any] | None = None
    received_at: datetime = Field(default_factory=datetime.utcnow)


class AiDocRecommendationResponse(BaseModel):
    recommendation: str  # "new" | "existing" | "none"
    reason: str
    suggested_document_id: uuid.UUID | None = None
    model: str
    created_at: str  # ISO timestamp


class ImpactAnalysisSummary(BaseModel):
    id: uuid.UUID
    recommended_strategy: str
    reasoning: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ProposalSummary(BaseModel):
    id: uuid.UUID
    impact_analysis_id: uuid.UUID
    document_id: uuid.UUID
    original_content: str
    proposed_content: str
    diff: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LatestProposalResponse(BaseModel):
    impact_analysis: ImpactAnalysisSummary
    proposal: ProposalSummary | None = None
    doc_mode_hint: str  # "new" | "existing"
