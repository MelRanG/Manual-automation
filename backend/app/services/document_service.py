import uuid
from pathlib import Path

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentVersion
from app.schemas.document import DocumentCreate
from app.services.chunking_service import chunk_and_embed_version

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


async def create_document(
    db: AsyncSession,
    data: DocumentCreate,
    content: str,
    source_file_url: str | None = None,
) -> Document:
    doc = Document(
        id=uuid.uuid4(),
        title=data.title,
        description=data.description,
        owner_id=data.owner_id,
        status="active",
        trust_score=1.0,
    )
    db.add(doc)
    await db.flush()

    version = DocumentVersion(
        id=uuid.uuid4(),
        document_id=doc.id,
        version_number=1,
        content=content,
        source_file_url=source_file_url,
        created_by=data.owner_id,
    )
    db.add(version)
    await db.flush()

    doc.current_version_id = version.id
    await db.commit()
    await db.refresh(doc)
    await db.refresh(version)

    await chunk_and_embed_version(db, version)
    return doc


async def get_document(db: AsyncSession, document_id: uuid.UUID) -> Document | None:
    result = await db.execute(select(Document).where(Document.id == document_id))
    return result.scalar_one_or_none()


async def list_documents(
    db: AsyncSession, skip: int = 0, limit: int = 20
) -> tuple[list[Document], int]:
    count_result = await db.execute(select(func.count(Document.id)))
    total = count_result.scalar_one()

    result = await db.execute(
        select(Document).order_by(Document.created_at.desc()).offset(skip).limit(limit)
    )
    return list(result.scalars().all()), total


async def create_new_version(
    db: AsyncSession,
    document_id: uuid.UUID,
    content: str,
    change_summary: str | None = None,
    created_by: uuid.UUID | None = None,
    source_file_url: str | None = None,
) -> DocumentVersion:
    doc = await get_document(db, document_id)
    if not doc:
        raise ValueError("Document not found")

    latest = await db.execute(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.desc())
        .limit(1)
    )
    latest_version = latest.scalar_one_or_none()
    next_number = (latest_version.version_number + 1) if latest_version else 1

    version = DocumentVersion(
        id=uuid.uuid4(),
        document_id=document_id,
        version_number=next_number,
        content=content,
        source_file_url=source_file_url,
        created_by=created_by,
        change_summary=change_summary,
    )
    db.add(version)
    await db.flush()

    doc.current_version_id = version.id
    await db.commit()
    await db.refresh(version)

    await chunk_and_embed_version(db, version)
    return version


async def update_document(
    db: AsyncSession,
    document_id: uuid.UUID,
    title: str | None = None,
    description: str | None = None,
    content: str | None = None,
    change_summary: str | None = None,
) -> Document:
    doc = await get_document(db, document_id)
    if not doc:
        raise ValueError("Document not found")

    if title is not None:
        doc.title = title
    if description is not None:
        doc.description = description

    await db.flush()

    if content is not None:
        await create_new_version(db, document_id, content, change_summary=change_summary)
        await db.refresh(doc)
    else:
        await db.commit()
        await db.refresh(doc)

    return doc


async def get_document_versions(
    db: AsyncSession, document_id: uuid.UUID
) -> list[DocumentVersion]:
    result = await db.execute(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.desc())
    )
    return list(result.scalars().all())


async def save_uploaded_file(filename: str, content: bytes) -> str:
    file_id = uuid.uuid4().hex[:8]
    safe_name = f"{file_id}_{filename}"
    path = UPLOAD_DIR / safe_name
    path.write_bytes(content)
    return f"/uploads/{safe_name}"
