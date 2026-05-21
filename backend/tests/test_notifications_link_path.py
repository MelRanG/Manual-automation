import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.routers.notifications import _serialize, create_notification


async def _make_user(db: AsyncSession, email: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        name="t",
        role="admin",
    )
    db.add(user)
    await db.commit()
    return user


@pytest.mark.asyncio(loop_scope="session")
async def test_create_notification_saves_link_path(db_session: AsyncSession):
    user = await _make_user(db_session, f"link-{uuid.uuid4().hex[:8]}@example.com")

    notif = await create_notification(
        db_session,
        user_id=user.id,
        type="manual_completed",
        title="t",
        message="m",
        link_path="/manuals?job=abc&tab=draft",
    )

    assert notif.link_path == "/manuals?job=abc&tab=draft"


@pytest.mark.asyncio(loop_scope="session")
async def test_serialize_includes_link_path(db_session: AsyncSession):
    user = await _make_user(db_session, f"serial-{uuid.uuid4().hex[:8]}@example.com")

    notif = await create_notification(
        db_session,
        user_id=user.id,
        type="t",
        title="t",
        message="m",
        link_path="/sr",
    )
    resp = _serialize(notif)
    assert resp.link_path == "/sr"


@pytest.mark.asyncio(loop_scope="session")
async def test_link_path_defaults_to_none(db_session: AsyncSession):
    user = await _make_user(db_session, f"none-{uuid.uuid4().hex[:8]}@example.com")

    notif = await create_notification(
        db_session,
        user_id=user.id,
        type="t",
        title="t",
        message="m",
    )
    assert notif.link_path is None
