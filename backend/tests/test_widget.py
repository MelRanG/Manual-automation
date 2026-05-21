import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_create_widget_session_anonymous(client: AsyncClient):
    resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["site_id"] == "test_site"
    assert "id" in data


@pytest.mark.asyncio(loop_scope="session")
async def test_create_widget_session_with_user_id(client: AsyncClient, test_user: dict):
    resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
        "user_id": test_user["id"],
    })
    assert resp.status_code == 201


def test_widget_session_create_accepts_user_id():
    from app.schemas.widget import WidgetSessionCreate
    m = WidgetSessionCreate(site_id="s", user_id="00000000-0000-0000-0000-000000000001")
    assert str(m.user_id) == "00000000-0000-0000-0000-000000000001"


def test_widget_session_create_rejects_non_uuid_user_id():
    import pytest
    from pydantic import ValidationError
    from app.schemas.widget import WidgetSessionCreate
    with pytest.raises(ValidationError):
        WidgetSessionCreate(site_id="s", user_id="not-a-uuid")


from sqlalchemy import select
from app.models.sr import SRDraft
from app.routers.widget import WIDGET_USER_ID


@pytest.mark.asyncio(loop_scope="session")
async def test_create_widget_session_unknown_user(client: AsyncClient):
    fake_user_id = str(uuid.uuid4())
    resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
        "user_id": fake_user_id,
    })
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_widget_ask_stream_anonymous_skips_sr_draft(client: AsyncClient, db_session):
    from sqlalchemy import func
    create_resp = await client.post("/api/widget/sessions", json={"site_id": "test_site"})
    session_id = create_resp.json()["id"]

    before = (await db_session.execute(
        select(func.count()).select_from(SRDraft).where(SRDraft.user_id == WIDGET_USER_ID)
    )).scalar() or 0

    async with client.stream(
        "POST", f"/api/widget/sessions/{session_id}/ask-stream",
        json={"question": "[변경 요청] 정책을 바꿔주세요"},
    ) as resp:
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk

    assert "sr_draft" not in body

    after = (await db_session.execute(
        select(func.count()).select_from(SRDraft).where(SRDraft.user_id == WIDGET_USER_ID)
    )).scalar() or 0
    assert after == before


@pytest.mark.asyncio(loop_scope="session")
async def test_widget_ask_stream_authenticated_session_owner(
    client: AsyncClient, test_user: dict, db_session
):
    create_resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
        "user_id": test_user["id"],
    })
    session_id = create_resp.json()["id"]

    from app.models.chat import ChatSession
    result = await db_session.execute(
        select(ChatSession).where(ChatSession.id == uuid.UUID(session_id))
    )
    session = result.scalar_one()
    assert str(session.user_id) == test_user["id"]


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_submit_blocked_for_widget_anonymous(client: AsyncClient, db_session):
    draft = SRDraft(
        id=uuid.uuid4(),
        user_id=WIDGET_USER_ID,
        title="anon SR",
        description="should not submit",
        priority="low",
        status="draft",
        created_by_ai=True,
    )
    db_session.add(draft)
    await db_session.commit()

    resp = await client.post(f"/api/sr/drafts/{draft.id}/submit")
    assert resp.status_code == 403
    assert "anonymous" in resp.json()["detail"].lower()


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_submit_allowed_for_authenticated_user(
    client: AsyncClient, db_session, test_user: dict
):
    draft = SRDraft(
        id=uuid.uuid4(),
        user_id=uuid.UUID(test_user["id"]),
        title="real SR",
        description="should submit",
        priority="low",
        status="draft",
        created_by_ai=True,
    )
    db_session.add(draft)
    await db_session.commit()

    resp = await client.post(f"/api/sr/drafts/{draft.id}/submit")
    # 200 success or 500 if Jira not configured both acceptable; 403 must NOT occur.
    assert resp.status_code != 403


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_blocked_for_widget_anonymous(client: AsyncClient):
    resp = await client.post("/api/feedback", json={
        "user_id": str(WIDGET_USER_ID),
        "feedback_text": "should be blocked",
    })
    assert resp.status_code == 403
    assert "anonymous" in resp.json()["detail"].lower()


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_allowed_for_authenticated_user(
    client: AsyncClient, test_user: dict
):
    resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "real feedback",
    })
    # 200/201 or other non-403 acceptable; 403 must NOT occur.
    assert resp.status_code != 403


@pytest.mark.asyncio(loop_scope="session")
async def test_widget_admin_list_excludes_empty(client: AsyncClient):
    empty_resp = await client.post("/api/widget/sessions", json={
        "site_id": "site-empty",
        "anonymous_id": "anon-empty",
    })
    assert empty_resp.status_code == 201
    empty_id = empty_resp.json()["id"]

    full_resp = await client.post("/api/widget/sessions", json={
        "site_id": "site-full",
        "anonymous_id": "anon-full",
    })
    assert full_resp.status_code == 201
    full_id = full_resp.json()["id"]

    # DB 에 직접 메시지 row 만들어 "메시지 있음" 상태 만듦
    from app.models.chat import ChatMessage
    from app.db import SessionLocal

    async with SessionLocal() as db:
        db.add(ChatMessage(id=uuid.uuid4(), session_id=uuid.UUID(full_id),
                            role="user", content="hi"))
        await db.commit()

    admin_resp = await client.get("/api/widget/admin/sessions")
    assert admin_resp.status_code == 200
    ids = [s["id"] for s in admin_resp.json()]
    assert full_id in ids
    assert empty_id not in ids


@pytest.mark.asyncio(loop_scope="session")
async def test_admin_delete_widget_session(client: AsyncClient):
    create_resp = await client.post("/api/widget/sessions", json={
        "site_id": "delete_test_site",
    })
    assert create_resp.status_code == 201
    session_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/widget/admin/sessions/{session_id}")
    assert del_resp.status_code == 204

    list_resp = await client.get("/api/widget/admin/sessions")
    assert list_resp.status_code == 200
    ids = [s["id"] for s in list_resp.json()]
    assert session_id not in ids


@pytest.mark.asyncio(loop_scope="session")
async def test_admin_delete_unknown_widget_session(client: AsyncClient):
    fake_id = uuid.uuid4()
    resp = await client.delete(f"/api/widget/admin/sessions/{fake_id}")
    assert resp.status_code == 404
