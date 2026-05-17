import uuid

from sqlalchemy import select, text, cast, func
from sqlalchemy.ext.asyncio import AsyncSession
from pgvector.sqlalchemy import Vector

from app.models.document import DocumentChunk, Document, DocumentVersion
from app.services.embedding_service import get_embedding_provider


async def search_similar_chunks(
    db: AsyncSession, query: str, top_k: int = 5
) -> list[dict]:
    provider = get_embedding_provider()
    [query_embedding] = await provider.embed([query])

    stmt = (
        select(
            DocumentChunk.id,
            DocumentChunk.content,
            DocumentChunk.chunk_index,
            DocumentChunk.document_version_id,
            DocumentVersion.document_id,
            Document.title.label("document_title"),
            DocumentChunk.embedding.cosine_distance(query_embedding).label("distance"),
        )
        .join(DocumentVersion, DocumentChunk.document_version_id == DocumentVersion.id)
        .join(Document, DocumentVersion.document_id == Document.id)
        .where(Document.status == "active")
        .where(DocumentChunk.embedding.isnot(None))
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(top_k)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return [
        {
            "chunk_id": row[0],
            "content": row[1],
            "chunk_index": row[2],
            "document_version_id": row[3],
            "document_id": row[4],
            "document_title": row[5],
            "distance": row[6],
        }
        for row in rows
    ]
