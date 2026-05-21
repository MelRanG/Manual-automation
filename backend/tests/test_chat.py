import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_create_chat_session(client: AsyncClient, test_user: dict):
    resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
        "title": "Test Session",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Test Session"
    assert data["user_id"] == test_user["id"]


@pytest.mark.asyncio(loop_scope="session")
async def test_list_chat_sessions(client: AsyncClient, test_user: dict):
    await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
    })
    resp = await client.get("/api/chat/sessions", params={"user_id": test_user["id"]})
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


@pytest.mark.asyncio(loop_scope="session")
async def test_ask_question_with_rag(client: AsyncClient, test_user: dict):
    # Create a document with content to search
    await client.post("/api/documents", json={
        "title": "Company Policy",
        "description": "HR policies",
        "owner_id": test_user["id"],
    }, params={"content": "Employees are entitled to 20 days of paid leave per year. Remote work is allowed on Fridays."})

    # Create chat session
    session_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
    })
    session_id = session_resp.json()["id"]

    # Ask a question
    resp = await client.post(f"/api/chat/sessions/{session_id}/ask", json={
        "question": "How many days of paid leave do employees get?",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["content"]
    assert data["message_id"]
    assert isinstance(data["citations"], list)


@pytest.mark.asyncio(loop_scope="session")
async def test_get_messages(client: AsyncClient, test_user: dict):
    session_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
    })
    session_id = session_resp.json()["id"]

    await client.post(f"/api/chat/sessions/{session_id}/ask", json={
        "question": "What is the refund policy?",
    })

    resp = await client.get(f"/api/chat/sessions/{session_id}/messages")
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"


@pytest.mark.asyncio(loop_scope="session")
async def test_ask_in_nonexistent_session(client: AsyncClient):
    resp = await client.post(
        "/api/chat/sessions/00000000-0000-0000-0000-000000000000/ask",
        json={"question": "test"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_session_with_citations(client: AsyncClient, test_user: dict):
    """세션 삭제 시 AnswerCitation도 함께 정리되어야 한다."""
    session_resp = await client.post("/api/chat/sessions", json={"user_id": test_user["id"]})
    session_id = session_resp.json()["id"]

    # 메시지 + citation 생성
    await client.post(
        f"/api/chat/sessions/{session_id}/ask",
        json={"question": "테스트 질문"},
    )

    # 삭제 — 현재 코드는 AnswerCitation.message_id 오타로 500
    resp = await client.delete(f"/api/chat/sessions/{session_id}")
    assert resp.status_code == 204

    # 세션 사라졌는지 확인
    get_resp = await client.get(f"/api/chat/sessions/{session_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_session_without_messages(client: AsyncClient, test_user: dict):
    """메시지 없는 세션도 삭제 가능해야 한다."""
    session_resp = await client.post("/api/chat/sessions", json={"user_id": test_user["id"]})
    session_id = session_resp.json()["id"]

    resp = await client.delete(f"/api/chat/sessions/{session_id}")
    assert resp.status_code == 204
