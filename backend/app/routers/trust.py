import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.services import trust_service

router = APIRouter(prefix="/api/trust", tags=["trust"])


@router.post("/{document_id}/recalculate")
async def recalculate_trust(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    score = await trust_service.calculate_trust_score(db, document_id)
    return {"document_id": str(document_id), "trust_score": score}


@router.get("")
async def list_trust_scores(db: AsyncSession = Depends(get_db)):
    return await trust_service.get_trust_scores(db)
