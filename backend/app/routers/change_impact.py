import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.change_impact import (
    ImpactAnalysisRequest,
    ImpactAnalysisResponse,
    ChangeProposalResponse,
)
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


@router.post("/{analysis_id}/proposals", response_model=list[ChangeProposalResponse])
async def generate_proposals(
    analysis_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    proposals = await change_impact_service.generate_change_proposals(db, analysis_id)
    return proposals


@router.get("", response_model=list[ImpactAnalysisResponse])
async def list_analyses(db: AsyncSession = Depends(get_db)):
    return await change_impact_service.list_analyses(db)
