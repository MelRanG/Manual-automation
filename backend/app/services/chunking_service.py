import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import DocumentChunk, DocumentVersion
from app.services.embedding_service import get_embedding_provider

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


def split_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    if not text.strip():
        return []

    paragraphs = text.split("\n\n")
    chunks: list[str] = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current_chunk) + len(para) + 2 <= chunk_size:
            current_chunk = f"{current_chunk}\n\n{para}" if current_chunk else para
        else:
            if current_chunk:
                chunks.append(current_chunk)
            if len(para) > chunk_size:
                words = para.split()
                current_chunk = ""
                for word in words:
                    if len(current_chunk) + len(word) + 1 <= chunk_size:
                        current_chunk = f"{current_chunk} {word}" if current_chunk else word
                    else:
                        if current_chunk:
                            chunks.append(current_chunk)
                        current_chunk = word
            else:
                current_chunk = para

    if current_chunk:
        chunks.append(current_chunk)

    if overlap > 0 and len(chunks) > 1:
        overlapped = [chunks[0]]
        for i in range(1, len(chunks)):
            prev_tail = chunks[i - 1][-overlap:]
            overlapped.append(prev_tail + " " + chunks[i])
        chunks = overlapped

    return chunks


async def chunk_and_embed_version(
    db: AsyncSession, version: DocumentVersion
) -> list[DocumentChunk]:
    chunks_text = split_text(version.content)
    if not chunks_text:
        return []

    provider = get_embedding_provider()
    embeddings = await provider.embed(chunks_text)

    db_chunks: list[DocumentChunk] = []
    for i, (text, embedding) in enumerate(zip(chunks_text, embeddings)):
        chunk = DocumentChunk(
            id=uuid.uuid4(),
            document_version_id=version.id,
            chunk_index=i,
            content=text,
            embedding=embedding,
            metadata_={"char_count": len(text)},
        )
        db.add(chunk)
        db_chunks.append(chunk)

    await db.commit()
    return db_chunks
