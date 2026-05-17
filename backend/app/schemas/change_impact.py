import uuid
from datetime import datetime

from pydantic import BaseModel


class ImpactAnalysisRequest(BaseModel):
    source_type: str  # "document_update", "sr_draft", "feedback"
    source_id: uuid.UUID
    related_document_ids: list[uuid.UUID] | None = None


class ImpactAnalysisResponse(BaseModel):
    id: uuid.UUID
    source_type: str
    source_id: uuid.UUID
    related_document_ids: list[str] | None
    recommended_strategy: str
    reasoning: str
    confidence: float
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChangeProposalResponse(BaseModel):
    id: uuid.UUID
    impact_analysis_id: uuid.UUID
    document_id: uuid.UUID
    original_content: str
    proposed_content: str
    diff: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
