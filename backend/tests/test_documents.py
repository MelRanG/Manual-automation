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


@pytest.mark.asyncio
async def test_update_document(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Original Title",
        "owner_id": test_user["id"],
    }, params={"content": "original content"})
    doc_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/documents/{doc_id}", json={
        "title": "Updated Title",
        "content": "updated content",
        "change_summary": "제목 및 내용 변경",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Updated Title"

    versions_resp = await client.get(f"/api/documents/{doc_id}/versions")
    assert len(versions_resp.json()) == 2


@pytest.mark.asyncio
async def test_update_document_not_found(client: AsyncClient):
    resp = await client.patch(
        "/api/documents/00000000-0000-0000-0000-000000000000",
        json={"title": "X"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_document_metadata_only(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Meta Only",
        "owner_id": test_user["id"],
    }, params={"content": "content stays"})
    doc_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/documents/{doc_id}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"

    versions_resp = await client.get(f"/api/documents/{doc_id}/versions")
    assert len(versions_resp.json()) == 1  # content 미변경이면 새 버전 없음


@pytest.mark.asyncio
async def test_delete_document(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "To Be Deleted",
        "owner_id": test_user["id"],
    }, params={"content": "content"})
    doc_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/documents/{doc_id}")
    assert resp.status_code == 200
    assert resp.json()["message"] == "archived"

    # 목록에서 사라져야 함
    list_resp = await client.get("/api/documents")
    ids = [d["id"] for d in list_resp.json()["documents"]]
    assert doc_id not in ids


@pytest.mark.asyncio
async def test_delete_document_not_found(client: AsyncClient):
    resp = await client.delete("/api/documents/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_export_document_txt(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Export Me",
        "owner_id": test_user["id"],
    }, params={"content": "export content"})
    doc_id = create_resp.json()["id"]

    resp = await client.get(f"/api/documents/{doc_id}/export?format=txt")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.text == "export content"


@pytest.mark.asyncio
async def test_export_document_md(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Export MD",
        "owner_id": test_user["id"],
    }, params={"content": "# heading"})
    doc_id = create_resp.json()["id"]

    resp = await client.get(f"/api/documents/{doc_id}/export?format=md")
    assert resp.status_code == 200
    assert "text/markdown" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.text == "# heading"


@pytest.mark.asyncio
async def test_export_document_invalid_format(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Export Bad",
        "owner_id": test_user["id"],
    }, params={"content": "x"})
    doc_id = create_resp.json()["id"]

    resp = await client.get(f"/api/documents/{doc_id}/export?format=docx")
    assert resp.status_code == 400
