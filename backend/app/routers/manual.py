import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db, SessionLocal
from app.schemas.manual import ManualJobCreate, ManualJobResponse
from app.services import manual_service

router = APIRouter(prefix="/api/manuals", tags=["manuals"])


@router.post("/jobs", response_model=ManualJobResponse, status_code=201)
async def create_manual_job(
    data: ManualJobCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    job = await manual_service.create_job(
        db,
        user_id=data.user_id,
        target_url=data.target_url,
        login_id=data.login_id,
        login_pw=data.login_pw,
        login_url=data.login_url,
        scenario_steps=data.scenario_steps,
        source_sr_id=data.source_sr_id,
    )
    background_tasks.add_task(run_generation_background, job.id)
    return job


async def run_generation_background(job_id: uuid.UUID):
    async with SessionLocal() as db:
        await manual_service.run_generation(db, job_id)


@router.get("/jobs", response_model=list[ManualJobResponse])
async def list_manual_jobs(
    user_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await manual_service.list_jobs(db, user_id)


@router.get("/jobs/{job_id}", response_model=ManualJobResponse)
async def get_manual_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    job = await manual_service.get_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
