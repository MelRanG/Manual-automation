import asyncio
import io
import uuid
from pathlib import Path

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models.document import Document, DocumentVersion
from app.schemas.document import DocumentCreate
from app.config import settings
from app.services.chunking_service import chunk_and_embed_version

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def convert_to_markdown(filename: str, file_bytes: bytes) -> str:
    """docx/xlsx/xls 파일을 마크다운 텍스트로 변환."""
    ext = Path(filename).suffix.lower()

    if ext == ".docx":
        import mammoth
        import markdownify
        result = mammoth.convert_to_html(io.BytesIO(file_bytes))
        return markdownify.markdownify(result.value, heading_style="ATX")

    if ext in (".xlsx", ".xls"):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        parts: list[str] = []
        for sheet in wb.worksheets:
            parts.append(f"## {sheet.title}\n")
            rows = list(sheet.iter_rows(values_only=True))
            if not rows:
                continue
            # header row
            header = [str(c) if c is not None else "" for c in rows[0]]
            parts.append("| " + " | ".join(header) + " |")
            parts.append("| " + " | ".join(["---"] * len(header)) + " |")
            for row in rows[1:]:
                cells = [str(c) if c is not None else "" for c in row]
                parts.append("| " + " | ".join(cells) + " |")
            parts.append("")
        wb.close()
        return "\n".join(parts)

    return file_bytes.decode("utf-8", errors="replace")


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
        document_type=data.document_type,
        domain=data.domain,
        audience=data.audience,
        source_type=data.source_type,
        source_file_url=source_file_url,
        related_sr_id=data.related_sr_id,
        jira_issue_key=data.jira_issue_key,
        tags=data.tags,
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

    asyncio.create_task(_embed_in_background(version.id))
    return doc


async def get_document(db: AsyncSession, document_id: uuid.UUID) -> Document | None:
    result = await db.execute(select(Document).where(Document.id == document_id))
    return result.scalar_one_or_none()


async def list_documents(
    db: AsyncSession, skip: int = 0, limit: int = 20
) -> tuple[list[Document], int]:
    base_filter = Document.status != "archived"

    count_result = await db.execute(select(func.count(Document.id)).where(base_filter))
    total = count_result.scalar_one()

    result = await db.execute(
        select(Document)
        .where(base_filter)
        .order_by(Document.created_at.desc())
        .offset(skip)
        .limit(limit)
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

    asyncio.create_task(_embed_in_background(version.id))
    return version


async def update_document(
    db: AsyncSession,
    document_id: uuid.UUID,
    title: str | None = None,
    description: str | None = None,
    content: str | None = None,
    change_summary: str | None = None,
    document_type: str | None = None,
    domain: str | None = None,
    audience: str | None = None,
    source_type: str | None = None,
    related_sr_id: uuid.UUID | None = None,
    jira_issue_key: str | None = None,
    tags: list[str] | None = None,
) -> Document:
    doc = await get_document(db, document_id)
    if not doc:
        raise ValueError("Document not found")

    if title is not None:
        doc.title = title
    if description is not None:
        doc.description = description
    if document_type is not None:
        doc.document_type = document_type
    if domain is not None:
        doc.domain = domain
    if audience is not None:
        doc.audience = audience
    if source_type is not None:
        doc.source_type = source_type
    if related_sr_id is not None:
        doc.related_sr_id = related_sr_id
    if jira_issue_key is not None:
        doc.jira_issue_key = jira_issue_key
    if tags is not None:
        doc.tags = tags

    await db.flush()

    if content is not None:
        await create_new_version(db, document_id, content, change_summary=change_summary)
        await db.refresh(doc)
    else:
        await db.commit()
        await db.refresh(doc)

    return doc


async def archive_document(db: AsyncSession, document_id: uuid.UUID) -> Document:
    doc = await get_document(db, document_id)
    if not doc:
        raise ValueError("Document not found")
    doc.status = "archived"
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
    if not settings.uploads_s3_bucket:
        raise RuntimeError("UPLOADS_S3_BUCKET is required for file uploads")

    file_id = uuid.uuid4().hex[:8]
    safe_name = f"{file_id}_{filename}"
    key = _build_s3_upload_key(safe_name)
    await asyncio.to_thread(_put_s3_object, key, content)
    return f"s3://{settings.uploads_s3_bucket}/{key}"


def _build_s3_upload_key(safe_name: str) -> str:
    prefix = settings.uploads_s3_prefix.strip("/")
    return f"{prefix}/{safe_name}" if prefix else safe_name


def _put_s3_object(key: str, content: bytes) -> None:
    import boto3

    client = boto3.client("s3", region_name=settings.aws_region)
    client.put_object(
        Bucket=settings.uploads_s3_bucket,
        Key=key,
        Body=content,
        ServerSideEncryption="AES256",
    )


async def _embed_in_background(version_id: uuid.UUID) -> None:
    """업로드 응답 후 백그라운드에서 청킹/임베딩을 실행한다."""
    try:
        async with SessionLocal() as db:
            result = await db.execute(
                select(DocumentVersion).where(DocumentVersion.id == version_id)
            )
            version = result.scalar_one_or_none()
            if version:
                await chunk_and_embed_version(db, version)
    except Exception:
        pass


async def suggest_tags(title: str, description: str, content: str) -> list[str]:
    """제목/설명/내용을 분석해 계층형 태그(depth 최대 3) 제안. 예: ['업무/재무/정산', '시스템/ERP']"""
    from app.services.llm_service import get_llm_provider
    import json, re

    llm = get_llm_provider()
    prompt = f"""문서 제목, 설명, 본문을 분석해서 계층형 태그를 추천해주세요.

규칙:
- 태그는 "/" 로 구분된 계층 구조입니다. 예: "업무/재무/정산", "시스템/ERP", "사용자/일반"
- depth는 최소 1, 최대 3입니다.
- 태그는 3~6개 추천하세요.
- 한국어로 작성하세요.
- 너무 구체적이거나 일회성 태그는 피하세요.
- 재사용 가능한 분류 체계를 사용하세요.

문서 제목: {title}
문서 설명: {description or "(없음)"}
본문 일부: {content[:1500] or "(없음)"}

다음 JSON 형식으로만 응답하세요:
{{"tags": ["태그1", "태그2", "태그3"]}}"""

    try:
        result = await llm.generate("당신은 문서 분류 전문가입니다. JSON만 반환하세요.", prompt)
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            data = json.loads(match.group(0))
            tags = data.get("tags", [])
            # 유효성 검사: 문자열만, depth 3 초과 제거
            return [t for t in tags if isinstance(t, str) and 0 < t.count("/") + 1 <= 3][:6]
    except Exception:
        pass
    return []
