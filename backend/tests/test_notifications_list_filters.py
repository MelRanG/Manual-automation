import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User


@pytest.mark.asyncio(loop_scope="session")
async def test_list_filters_by_type_and_unread(
    db_session: AsyncSession, client: AsyncClient
):
    user = User(
        id=uuid.uuid4(),
        email=f"filters-{uuid.uuid4().hex[:8]}@example.com",
        name="u",
        role="admin",
    )
    db_session.add(user)
    for i in range(3):
        db_session.add(
            Notification(
                user_id=user.id,
                type="manual_completed",
                title=f"m{i}",
                message="x",
                is_read=(i == 0),
            )
        )
    for i in range(2):
        db_session.add(
            Notification(
                user_id=user.id,
                type="document_converted",
                title=f"d{i}",
                message="x",
            )
        )
    await db_session.commit()

    headers = {"X-User-Id": str(user.id)}

    r = await client.get(
        "/api/notifications?type=manual_completed", headers=headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert all(n["type"] == "manual_completed" for n in body["items"])

    r = await client.get(
        "/api/notifications?unread_only=true", headers=headers
    )
    body = r.json()
    assert body["total"] == 4  # 2 unread manual + 2 unread doc
    assert all(n["is_read"] is False for n in body["items"])

    r = await client.get(
        "/api/notifications?skip=0&limit=2", headers=headers
    )
    body = r.json()
    assert len(body["items"]) == 2
    assert body["total"] == 5
