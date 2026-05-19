import asyncio
import sys
import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.db import get_db
from app.main import app

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@pytest.fixture(scope="session")
def event_loop_policy():
    if sys.platform == "win32":
        return asyncio.WindowsSelectorEventLoopPolicy()
    return asyncio.DefaultEventLoopPolicy()


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def engine():
    eng = create_async_engine(settings.database_url, pool_size=5, max_overflow=10)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def client(engine) -> AsyncGenerator[AsyncClient, None]:
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(engine) -> AsyncGenerator[AsyncSession, None]:
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture(loop_scope="session")
async def test_user(client: AsyncClient) -> dict:
    resp = await client.post("/api/users", json={
        "name": "Test User",
        "email": f"test_{uuid.uuid4().hex[:8]}@example.com",
        "role": "admin",
    })
    assert resp.status_code == 201
    return resp.json()
