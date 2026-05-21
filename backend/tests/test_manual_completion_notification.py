import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual import ManualGenerationJob
from app.models.user import User
from app.services import manual_service


async def _make_user(db: AsyncSession, email: str) -> User:
    user = User(id=uuid.uuid4(), email=email, name="m", role="admin")
    db.add(user)
    await db.commit()
    return user


@pytest.mark.asyncio(loop_scope="session")
async def test_completed_job_emits_notification(db_session: AsyncSession):
    user = await _make_user(
        db_session, f"manual-ok-{uuid.uuid4().hex[:8]}@example.com"
    )
    job = ManualGenerationJob(
        id=uuid.uuid4(),
        user_id=user.id,
        target_url="https://example.com",
        status="pending",
    )
    db_session.add(job)
    await db_session.commit()

    with patch.object(
        manual_service, "capture_screenshots", new=AsyncMock(return_value=[])
    ), patch.object(
        manual_service, "generate_markdown", new=AsyncMock(return_value="# manual")
    ), patch(
        "app.routers.notifications.create_notification",
        new=AsyncMock(),
    ) as mock_notif:
        await manual_service.run_generation(db_session, job.id)

    assert mock_notif.await_count >= 1
    kwargs = mock_notif.await_args.kwargs
    assert kwargs["type"] == "manual_completed"
    assert kwargs["link_path"] == f"/manuals?job={job.id}&tab=draft"
    assert kwargs["user_id"] == user.id


@pytest.mark.asyncio(loop_scope="session")
async def test_notification_failure_does_not_break_completion(
    db_session: AsyncSession,
):
    user = await _make_user(
        db_session, f"manual-fail-{uuid.uuid4().hex[:8]}@example.com"
    )
    job = ManualGenerationJob(
        id=uuid.uuid4(),
        user_id=user.id,
        target_url="https://example.com",
        status="pending",
    )
    db_session.add(job)
    await db_session.commit()

    with patch.object(
        manual_service, "capture_screenshots", new=AsyncMock(return_value=[])
    ), patch.object(
        manual_service, "generate_markdown", new=AsyncMock(return_value="# manual")
    ), patch(
        "app.routers.notifications.create_notification",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        result = await manual_service.run_generation(db_session, job.id)

    assert result.status == "completed"
