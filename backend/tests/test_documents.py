import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_document(client: AsyncClient, test_user: dict):
    resp = await client.post("/api/documents", json={
        "title": "Test Document",
        "description": "A test document",
        "owner_id": test_user["id"],
    }, params={"content": "Hello world"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Test Document"
    assert data["status"] == "active"
    assert data["trust_score"] == 1.0
    assert data["current_version_id"] is not None


@pytest.mark.asyncio
async def test_list_documents(client: AsyncClient, test_user: dict):
    await client.post("/api/documents", json={
        "title": "Doc 1",
        "owner_id": test_user["id"],
    }, params={"content": "content 1"})
    await client.post("/api/documents", json={
        "title": "Doc 2",
        "owner_id": test_user["id"],
    }, params={"content": "content 2"})

    resp = await client.get("/api/documents")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 2
    assert len(data["documents"]) >= 2


@pytest.mark.asyncio
async def test_get_document(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Get Me",
        "owner_id": test_user["id"],
    }, params={"content": "body"})
    doc_id = create_resp.json()["id"]

    resp = await client.get(f"/api/documents/{doc_id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Get Me"


@pytest.mark.asyncio
async def test_get_document_not_found(client: AsyncClient):
    resp = await client.get("/api/documents/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_upload_document(client: AsyncClient, test_user: dict):
    resp = await client.post("/api/documents/upload", data={
        "title": "Uploaded Doc",
        "description": "From file",
        "owner_id": test_user["id"],
    }, files={"file": ("test.txt", b"File content here", "text/plain")})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Uploaded Doc"


@pytest.mark.asyncio
async def test_create_new_version(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Versioned",
        "owner_id": test_user["id"],
    }, params={"content": "v1 content"})
    doc_id = create_resp.json()["id"]

    resp = await client.post(f"/api/documents/{doc_id}/versions", data={
        "content": "v2 content",
        "change_summary": "Updated content",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["version_number"] == 2
    assert data["content"] == "v2 content"


@pytest.mark.asyncio
async def test_get_versions(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Multi Version",
        "owner_id": test_user["id"],
    }, params={"content": "first"})
    doc_id = create_resp.json()["id"]

    await client.post(f"/api/documents/{doc_id}/versions", data={
        "content": "second",
    })

    resp = await client.get(f"/api/documents/{doc_id}/versions")
    assert resp.status_code == 200
    versions = resp.json()
    assert len(versions) == 2
    assert versions[0]["version_number"] == 2
    assert versions[1]["version_number"] == 1
