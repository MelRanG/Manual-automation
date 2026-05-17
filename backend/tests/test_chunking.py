import pytest
from httpx import AsyncClient

from app.services.chunking_service import split_text
from app.services.embedding_service import MockEmbeddingProvider


def test_split_text_basic():
    text = "Hello world. " * 100
    chunks = split_text(text, chunk_size=100, overlap=0)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 150


def test_split_text_empty():
    assert split_text("") == []
    assert split_text("   ") == []


def test_split_text_paragraphs():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunks = split_text(text, chunk_size=500, overlap=0)
    assert len(chunks) == 1
    assert "Paragraph one." in chunks[0]


def test_split_text_with_overlap():
    text = "A" * 200 + "\n\n" + "B" * 200 + "\n\n" + "C" * 200
    chunks = split_text(text, chunk_size=250, overlap=50)
    assert len(chunks) >= 2


@pytest.mark.asyncio(loop_scope="session")
async def test_mock_embedding_provider():
    provider = MockEmbeddingProvider()
    result = await provider.embed(["hello world", "test text"])
    assert len(result) == 2
    assert len(result[0]) == 1536
    assert len(result[1]) == 1536
    assert all(0.0 <= v <= 1.0 for v in result[0])


@pytest.mark.asyncio(loop_scope="session")
async def test_document_gets_chunked_on_create(client: AsyncClient, test_user: dict):
    long_text = "\n\n".join([f"Paragraph {i}. " + "x" * 200 for i in range(10)])
    resp = await client.post("/api/documents", json={
        "title": "Chunked Doc",
        "owner_id": test_user["id"],
    }, params={"content": long_text})
    assert resp.status_code == 201
