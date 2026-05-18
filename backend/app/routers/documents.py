import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.document import Document
from app.models.feedback import FeedbackReport, ApprovalRequest
from app.schemas.document import (
    DocumentCreate,
    DocumentUpdate,
    DocumentResponse,
    DocumentListResponse,
    DocumentVersionResponse,
)
from app.services import document_service

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("/stats/dashboard")
async def dashboard_stats(db: AsyncSession = Depends(get_db)):
    ninety_days_ago = datetime.now(timezone.utc) - timedelta(days=90)

    # Low trust documents
    low_trust = await db.execute(
        select(Document).where(Document.trust_score < 0.8).order_by(Document.trust_score.asc()).limit(5)
    )
    low_trust_docs = low_trust.scalars().all()

    # Documents with most error reports
    feedback_counts = await db.execute(
        select(FeedbackReport.document_id, func.count(FeedbackReport.id).label("cnt"))
        .where(FeedbackReport.document_id.isnot(None))
        .group_by(FeedbackReport.document_id)
        .order_by(func.count(FeedbackReport.id).desc())
        .limit(5)
    )
    error_doc_ids = [row[0] for row in feedback_counts.all()]
    error_docs = []
    if error_doc_ids:
        result = await db.execute(select(Document).where(Document.id.in_(error_doc_ids)))
        error_docs = result.scalars().all()

    # Pending approval documents
    pending_approvals = await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.status.in_(["pending", "needs_review"])).limit(5)
    )
    pending_list = pending_approvals.scalars().all()

    # Most viewed documents
    most_viewed = await db.execute(
        select(Document).where(Document.view_count > 0).order_by(Document.view_count.desc()).limit(5)
    )
    most_viewed_docs = most_viewed.scalars().all()

    # Stale documents (not updated in 90 days)
    stale_docs_result = await db.execute(
        select(Document).where(Document.updated_at < ninety_days_ago).order_by(Document.updated_at.asc()).limit(5)
    )
    stale_docs = stale_docs_result.scalars().all()

    # Documents without owner
    no_owner = await db.execute(
        select(Document).where(Document.owner_id.is_(None)).limit(5)
    )
    no_owner_docs = no_owner.scalars().all()

    def doc_summary(d: Document) -> dict:
        return {"id": str(d.id), "title": d.title, "trust_score": d.trust_score, "view_count": d.view_count, "updated_at": d.updated_at.isoformat() if d.updated_at else None}

    return {
        "low_trust": [doc_summary(d) for d in low_trust_docs],
        "most_errors": [doc_summary(d) for d in error_docs],
        "pending_approvals": [{"id": str(a.id), "proposed_change_id": str(a.proposed_change_id), "status": a.status, "created_at": a.created_at.isoformat()} for a in pending_list],
        "most_viewed": [doc_summary(d) for d in most_viewed_docs],
        "stale": [doc_summary(d) for d in stale_docs],
        "no_owner": [doc_summary(d) for d in no_owner_docs],
    }


@router.post("", response_model=DocumentResponse, status_code=201)
async def create_document(
    data: DocumentCreate,
    content: str = "",
    db: AsyncSession = Depends(get_db),
):
    doc = await document_service.create_document(db, data, content)
    return doc


@router.post("/upload", response_model=DocumentResponse, status_code=201)
async def upload_document(
    title: str = Form(...),
    description: str = Form(None),
    owner_id: str = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    file_bytes = await file.read()
    content = file_bytes.decode("utf-8", errors="replace")
    file_url = await document_service.save_uploaded_file(file.filename or "upload.txt", file_bytes)

    data = DocumentCreate(
        title=title,
        description=description,
        owner_id=uuid.UUID(owner_id) if owner_id else None,
    )
    doc = await document_service.create_document(db, data, content, source_file_url=file_url)
    return doc


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    docs, total = await document_service.list_documents(db, skip, limit)
    return DocumentListResponse(documents=docs, total=total)


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    doc = await document_service.get_document(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.view_count = (doc.view_count or 0) + 1
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/{document_id}/versions", response_model=list[DocumentVersionResponse])
async def get_document_versions(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    doc = await document_service.get_document(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    versions = await document_service.get_document_versions(db, document_id)
    return versions


@router.post("/{document_id}/versions", response_model=DocumentVersionResponse, status_code=201)
async def create_version(
    document_id: uuid.UUID,
    content: str = Form(...),
    change_summary: str = Form(None),
    file: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
):
    doc = await document_service.get_document(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_url = None
    if file:
        file_bytes = await file.read()
        content = file_bytes.decode("utf-8", errors="replace")
        file_url = await document_service.save_uploaded_file(file.filename or "upload.txt", file_bytes)

    version = await document_service.create_new_version(
        db, document_id, content, change_summary=change_summary, source_file_url=file_url
    )
    return version


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: uuid.UUID,
    data: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        doc = await document_service.update_document(
            db,
            document_id,
            title=data.title,
            description=data.description,
            content=data.content,
            change_summary=data.change_summary,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/{document_id}")
async def delete_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    try:
        await document_service.archive_document(db, document_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"message": "archived"}


@router.get("/{document_id}/export")
async def export_document(
    document_id: uuid.UUID,
    format: str = "txt",
    db: AsyncSession = Depends(get_db),
):
    if format not in ("txt", "md"):
        raise HTTPException(status_code=400, detail="format must be txt or md")

    doc = await document_service.get_document(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    versions = await document_service.get_document_versions(db, document_id)
    content = versions[0].content if versions else ""

    safe_title = doc.title.replace("/", "_").replace("\\", "_")
    media_type = "text/plain" if format == "txt" else "text/markdown"

    return Response(
        content=content,
        media_type=f"{media_type}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.{format}"'},
    )
