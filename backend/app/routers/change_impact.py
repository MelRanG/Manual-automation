import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.change_impact import (
    ImpactAnalysisRequest,
    ImpactAnalysisResponse,
    ChangeProposalResponse,
)
from pydantic import BaseModel
class StrategyRecommendationRequest(BaseModel):
    document_id: uuid.UUID

class StrategyRecommendationResponse(BaseModel):
    recommended_strategy: str
    confidence: float
    reasoning: str

class GenerateProposalRequest(BaseModel):
    document_id: uuid.UUID
    strategy: str
from app.services import change_impact_service

router = APIRouter(prefix="/api/change-impact", tags=["change-impact"])


@router.post("/analyze", response_model=ImpactAnalysisResponse, status_code=201)
async def analyze_impact(
    data: ImpactAnalysisRequest,
    db: AsyncSession = Depends(get_db),
):
    return await change_impact_service.analyze_impact(
        db, data.source_type, data.source_id, data.related_document_ids
    )


@router.post("/{analysis_id}/recommend-strategy", response_model=StrategyRecommendationResponse)
async def recommend_strategy(
    analysis_id: uuid.UUID,
    data: StrategyRecommendationRequest,
    db: AsyncSession = Depends(get_db),
):
    return await change_impact_service.recommend_strategy_for_document(db, analysis_id, data.document_id)

@router.post("/{analysis_id}/proposals", response_model=ChangeProposalResponse)
async def generate_proposal_for_document(
    analysis_id: uuid.UUID,
    data: GenerateProposalRequest,
    db: AsyncSession = Depends(get_db),
):
    proposal = await change_impact_service.generate_change_proposal_with_strategy(
        db, analysis_id, data.document_id, data.strategy
    )
    return proposal


@router.get("", response_model=list[ImpactAnalysisResponse])
async def list_analyses(db: AsyncSession = Depends(get_db)):
    return await change_impact_service.list_analyses(db)


@router.get("/{analysis_id}/proposals", response_model=list[ChangeProposalResponse])
async def list_proposals(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.sr import DocumentChangeProposal
    result = await db.execute(
        select(DocumentChangeProposal).where(DocumentChangeProposal.impact_analysis_id == analysis_id)
    )
    return list(result.scalars().all())


@router.post("/{analysis_id}/proposals/{proposal_id}/apply")
async def apply_proposal(
    analysis_id: uuid.UUID,
    proposal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await change_impact_service.apply_proposal(db, proposal_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
