import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_create_user(client: AsyncClient):
    resp = await client.post("/api/users", json={
        "name": "John Doe",
        "email": f"john_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
        "department": "Engineering",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "John Doe"
    assert data["role"] == "editor"
    assert data["department"] == "Engineering"


@pytest.mark.asyncio(loop_scope="session")
async def test_duplicate_email_rejected(client: AsyncClient):
    email = f"dup_{uuid.uuid4().hex[:8]}@example.com"
    await client.post("/api/users", json={"name": "First", "email": email})
    resp = await client.post("/api/users", json={"name": "Second", "email": email})
    assert resp.status_code == 409


@pytest.mark.asyncio(loop_scope="session")
async def test_get_user_not_found(client: AsyncClient):
    resp = await client.get("/api/users/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_list_users(client: AsyncClient):
    email = f"list_{uuid.uuid4().hex[:8]}@example.com"
    await client.post("/api/users", json={"name": "List User", "email": email})
    resp = await client.get("/api/users")
    assert resp.status_code == 200
    assert any(u["email"] == email for u in resp.json())


@pytest.mark.asyncio(loop_scope="session")
async def test_invalid_email_rejected(client: AsyncClient):
    resp = await client.post("/api/users", json={
        "name": "Bad Email",
        "email": "not-an-email",
    })
    assert resp.status_code == 422
