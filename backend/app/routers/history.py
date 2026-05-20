import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.schemas.history import ChangeHistoryResponse
from app.services import history_service

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("/{entity_type}/{entity_id}", response_model=list[ChangeHistoryResponse])
async def get_history(
    entity_type: str,
    entity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await history_service.list_events(db, entity_type, entity_id)
