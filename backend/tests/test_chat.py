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
    # 문서 + ask 로 메시지 있는 세션 보장
    await client.post("/api/documents", json={
        "title": "Doc for list",
        "description": "x",
        "owner_id": test_user["id"],
    }, params={"content": "content"})
    sess_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
    })
    sess_id = sess_resp.json()["id"]
    ask_resp = await client.post(f"/api/chat/sessions/{sess_id}/ask", json={
        "question": "anything?",
    })
    assert ask_resp.status_code == 200
    resp = await client.get("/api/chat/sessions", params={"user_id": test_user["id"]})
    assert resp.status_code == 200
    ids = [s["id"] for s in resp.json()]
    assert sess_id in ids


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


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_session_with_feedback(client: AsyncClient, test_user: dict):
    # 문서 → 세션 → 질문(메시지 2건) → 피드백 부착 후 삭제
    doc_resp = await client.post("/api/documents", json={
        "title": "Doc for delete",
        "description": "x",
        "owner_id": test_user["id"],
    }, params={"content": "content for delete"})
    assert doc_resp.status_code == 201

    sess_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
    })
    session_id = sess_resp.json()["id"]

    ask_resp = await client.post(f"/api/chat/sessions/{session_id}/ask", json={
        "question": "anything?",
    })
    assert ask_resp.status_code == 200
    message_id = ask_resp.json()["message_id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "chat_message_id": message_id,
        "feedback_text": "wrong answer",
    })
    assert fb_resp.status_code in (200, 201)

    del_resp = await client.delete(f"/api/chat/sessions/{session_id}")
    assert del_resp.status_code == 204

    get_resp = await client.get(f"/api/chat/sessions/{session_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sessions_excludes_empty(client: AsyncClient, test_user: dict):
    # 메시지가 없는 빈 세션 생성
    empty_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
        "title": "Empty Session",
    })
    assert empty_resp.status_code == 201
    empty_id = empty_resp.json()["id"]

    # 메시지가 있는 세션 생성 (문서 등록 후 ask)
    await client.post("/api/documents", json={
        "title": "Leave Policy",
        "description": "HR",
        "owner_id": test_user["id"],
    }, params={"content": "Employees get 20 days paid leave."})
    sess_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
        "title": "Has Message",
    })
    sess_id = sess_resp.json()["id"]
    ask_resp = await client.post(f"/api/chat/sessions/{sess_id}/ask", json={
        "question": "How many leave days?",
    })
    assert ask_resp.status_code == 200

    # list 응답에서 빈 세션은 없어야 함
    list_resp = await client.get("/api/chat/sessions", params={"user_id": test_user["id"]})
    assert list_resp.status_code == 200
    ids = [s["id"] for s in list_resp.json()]
    assert sess_id in ids
    assert empty_id not in ids
