# 멀티턴 채팅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 위젯 채팅과 일반 채팅 모두에서 이전 대화 히스토리를 LLM에 전달해 진정한 멀티턴 대화를 구현한다.

**Architecture:** 매 요청 시 DB에서 세션의 이전 메시지를 로드(최근 20개)해 Bedrock/Anthropic/OpenAI의 네이티브 `messages` 배열로 전달한다. `LLMProvider`에 `generate_with_history`/`generate_stream_with_history` 메서드를 추가하고, `chat_service`의 `ask_question`/`ask_question_stream`에서 이를 호출한다.

**Tech Stack:** Python FastAPI, SQLAlchemy async, Anthropic Bedrock SDK, anthropic SDK, openai SDK

---

## 변경 파일

- Modify: `backend/app/services/llm_service.py` — 각 Provider에 `generate_with_history`, `generate_stream_with_history` 추가
- Modify: `backend/app/services/chat_service.py` — `ask_question`, `ask_question_stream`에서 히스토리 로드 후 새 메서드 호출
- Modify: `backend/tests/test_chat_service.py` — 멀티턴 관련 테스트 추가

---

### Task 1: LLMProvider 인터페이스 및 MockLLMProvider 구현

**Files:**
- Modify: `backend/app/services/llm_service.py:8-49`
- Modify: `backend/tests/test_chat_service.py`

- [ ] **Step 1: 테스트 작성**

`backend/tests/test_chat_service.py` 맨 아래에 추가:

```python
import asyncio
import pytest
from app.services.llm_service import MockLLMProvider


@pytest.mark.asyncio
async def test_mock_generate_with_history_uses_last_message():
    """generate_with_history는 마지막 user 메시지를 기반으로 응답을 생성한다."""
    llm = MockLLMProvider()
    messages = [
        {"role": "user", "content": "첫 번째 질문"},
        {"role": "assistant", "content": "첫 번째 답변"},
        {"role": "user", "content": "두 번째 질문"},
    ]
    result = await llm.generate_with_history("system", messages)
    assert isinstance(result, str)
    assert len(result) > 0


@pytest.mark.asyncio
async def test_mock_generate_stream_with_history_yields_tokens():
    """generate_stream_with_history는 토큰을 순서대로 yield한다."""
    llm = MockLLMProvider()
    messages = [{"role": "user", "content": "테스트 질문"}]
    tokens = []
    async for token in llm.generate_stream_with_history("system", messages):
        tokens.append(token)
    assert len(tokens) > 0
    assert "".join(tokens)  # 빈 문자열이 아님
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd backend && uv run pytest tests/test_chat_service.py::test_mock_generate_with_history_uses_last_message tests/test_chat_service.py::test_mock_generate_stream_with_history_yields_tokens -v
```

Expected: FAIL — `MockLLMProvider has no attribute 'generate_with_history'`

- [ ] **Step 3: LLMProvider ABC에 추상 메서드 추가 및 MockLLMProvider 구현**

`backend/app/services/llm_service.py`의 `LLMProvider` 클래스를 아래로 교체:

```python
class LLMProvider(ABC):
    @abstractmethod
    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        ...

    @abstractmethod
    async def generate_stream(self, system_prompt: str, user_message: str, context: str = "") -> AsyncGenerator[str, None]:
        ...

    @abstractmethod
    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        ...

    @abstractmethod
    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        ...
```

`MockLLMProvider`를 아래로 교체 (기존 `generate_stream_with_history` fallback 메서드는 제거):

```python
class MockLLMProvider(LLMProvider):
    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        if context:
            return (
                f"Based on the provided documentation, here is my answer to your question "
                f"about '{user_message[:50]}': The relevant information indicates that the "
                f"documentation covers this topic. [Source: provided context]"
            )
        return f"I can help with '{user_message[:50]}'. However, I don't have specific documentation context to reference for this query."

    async def generate_stream(self, system_prompt: str, user_message: str, context: str = "") -> AsyncGenerator[str, None]:
        full_response = await self.generate(system_prompt, user_message, context)
        words = full_response.split(" ")
        for i, word in enumerate(words):
            yield word if i == 0 else f" {word}"
            await asyncio.sleep(0.03)

    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        return await self.generate(system_prompt, last_user, context)

    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        async for token in self.generate_stream(system_prompt, last_user, context):
            yield token
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
cd backend && uv run pytest tests/test_chat_service.py -v
```

Expected: 5 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/llm_service.py backend/tests/test_chat_service.py
git commit -m "feat: LLMProvider에 generate_with_history 인터페이스 및 Mock 구현 추가"
```

---

### Task 2: BedrockLLMProvider 멀티턴 구현

**Files:**
- Modify: `backend/app/services/llm_service.py:52-108`

Bedrock/Anthropic SDK는 동일한 `messages` 배열 형식을 사용한다. context는 첫 번째 user 메시지 content 앞에 prepend한다.

- [ ] **Step 1: BedrockLLMProvider에 두 메서드 추가**

`BedrockLLMProvider` 클래스 끝(line 108 `yield text` 다음)에 추가:

```python
    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        prepared = _prepend_context(messages, context)
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            system=system_prompt,
            messages=prepared,
        )
        return response.content[0].text  # type: ignore[union-attr]

    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        prepared = _prepend_context(messages, context)
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=2048,
            system=system_prompt,
            messages=prepared,
        ) as stream:
            async for text in stream.text_stream:
                yield text
```

- [ ] **Step 2: `_prepend_context` 헬퍼 함수를 모듈 상단(imports 다음)에 추가**

`from app.config import settings` 바로 다음 줄에 추가:

```python
def _prepend_context(messages: list[dict], context: str) -> list[dict]:
    """context가 있으면 첫 번째 user 메시지 앞에 RAG context를 prepend한다."""
    if not context or not messages:
        return messages
    result = list(messages)
    for i, m in enumerate(result):
        if m["role"] == "user":
            result[i] = {
                "role": "user",
                "content": f"Context from documentation:\n{context}\n\nUser question: {m['content']}",
            }
            break
    return result
```

- [ ] **Step 3: 테스트 실행 — 기존 테스트 PASS 확인**

```bash
cd backend && uv run pytest tests/test_chat_service.py -v
```

Expected: 5 passed (새 테스트 없음 — Bedrock은 실제 AWS 연결 필요)

- [ ] **Step 4: 커밋**

```bash
git add backend/app/services/llm_service.py
git commit -m "feat: BedrockLLMProvider 멀티턴 구현"
```

---

### Task 3: AnthropicLLMProvider, OpenAILLMProvider 멀티턴 구현

**Files:**
- Modify: `backend/app/services/llm_service.py:111-180`

- [ ] **Step 1: AnthropicLLMProvider에 두 메서드 추가**

`AnthropicLLMProvider` 클래스 끝(`yield text` 다음)에 추가:

```python
    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        prepared = _prepend_context(messages, context)
        response = await self.client.messages.create(
            model="claude-sonnet-4-6-20251101",
            max_tokens=2048,
            system=system_prompt,
            messages=prepared,
        )
        return response.content[0].text  # type: ignore[union-attr]

    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        prepared = _prepend_context(messages, context)
        async with self.client.messages.stream(
            model="claude-sonnet-4-6-20251101",
            max_tokens=2048,
            system=system_prompt,
            messages=prepared,
        ) as stream:
            async for text in stream.text_stream:
                yield text
```

- [ ] **Step 2: OpenAILLMProvider에 두 메서드 추가**

`OpenAILLMProvider` 클래스 끝(`yield chunk.choices[0].delta.content` 다음)에 추가:

```python
    async def generate_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> str:
        prepared = _prepend_context(messages, context)
        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "system", "content": system_prompt}] + prepared,
            max_tokens=2048,
        )
        return response.choices[0].message.content

    async def generate_stream_with_history(self, system_prompt: str, messages: list[dict], context: str = "") -> AsyncGenerator[str, None]:
        prepared = _prepend_context(messages, context)
        stream = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "system", "content": system_prompt}] + prepared,
            max_tokens=2048,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
```

- [ ] **Step 3: 테스트 실행 — PASS 확인**

```bash
cd backend && uv run pytest tests/test_chat_service.py -v
```

Expected: 5 passed

- [ ] **Step 4: 커밋**

```bash
git add backend/app/services/llm_service.py
git commit -m "feat: Anthropic/OpenAI Provider 멀티턴 구현"
```

---

### Task 4: chat_service — ask_question_stream 히스토리 연동

**Files:**
- Modify: `backend/app/services/chat_service.py:212-324`
- Modify: `backend/tests/test_chat_service.py`

- [ ] **Step 1: 테스트 작성**

`backend/tests/test_chat_service.py` 맨 아래에 추가:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import uuid


@pytest.mark.asyncio
async def test_ask_question_stream_includes_history():
    """ask_question_stream은 이전 메시지를 포함한 messages 배열을 LLM에 전달한다."""
    from app.services.chat_service import ask_question_stream

    session_id = uuid.uuid4()
    user_id = uuid.uuid4()

    mock_session = MagicMock()
    mock_session.id = session_id
    mock_session.user_id = user_id
    mock_session.title = "test"

    prev_user = MagicMock()
    prev_user.role = "user"
    prev_user.content = "이전 질문"

    prev_assistant = MagicMock()
    prev_assistant.role = "assistant"
    prev_assistant.content = "이전 답변"

    async def mock_stream(system_prompt, messages, context=""):
        assert len(messages) == 3  # 이전 2개 + 현재 1개
        assert messages[0]["content"] == "이전 질문"
        assert messages[1]["content"] == "이전 답변"
        assert messages[2]["content"] == "현재 질문"
        yield "응답 토큰"

    mock_db = AsyncMock()

    with patch("app.services.chat_service.get_session", return_value=mock_session), \
         patch("app.services.chat_service.get_messages", return_value=[prev_user, prev_assistant]), \
         patch("app.services.chat_service.search_similar_chunks", return_value=[]), \
         patch("app.services.chat_service.get_llm_provider") as mock_provider_fn:

        mock_llm = MagicMock()
        mock_llm.generate_stream_with_history = mock_stream
        mock_provider_fn.return_value = mock_llm

        events = []
        async for event in ask_question_stream(mock_db, session_id, "현재 질문"):
            events.append(event)

        token_events = [e for e in events if "token" in e]
        assert len(token_events) > 0
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd backend && uv run pytest tests/test_chat_service.py::test_ask_question_stream_includes_history -v
```

Expected: FAIL — `generate_stream` 호출로 인해 messages 배열 assertion 실패

- [ ] **Step 3: ask_question_stream 수정**

`chat_service.py`의 `ask_question_stream` 함수에서 다음 부분을 교체:

변경 전 (line 215-241):
```python
    # TODO: 현재 각 요청이 단일 메시지로 처리됨 (대화 히스토리 미전달).
    # change_request 모드에서 멀티턴으로 정보를 수집하려면 이전 메시지들을
    # LLM context에 포함해야 함. 현재는 단일 메시지에 모든 필수 정보가 포함된 경우만 동작.
    session = await get_session(db, session_id)
    if not session:
        raise ValueError("Session not found")

    user_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    await db.flush()

    relevant_chunks = await search_similar_chunks(db, question, top_k=5)

    context = "\n\n---\n\n".join(
        f"[{c['document_title']}] {c['content']}" for c in relevant_chunks
    )

    llm = get_llm_provider()
    full_content = ""

    async for token in llm.generate_stream(RAG_SYSTEM_PROMPT, question, context):
```

변경 후:
```python
    session = await get_session(db, session_id)
    if not session:
        raise ValueError("Session not found")

    history = await get_messages(db, session_id)

    user_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    await db.flush()

    relevant_chunks = await search_similar_chunks(db, question, top_k=5)

    context = "\n\n---\n\n".join(
        f"[{c['document_title']}] {c['content']}" for c in relevant_chunks
    )

    messages = [{"role": m.role, "content": m.content} for m in history[-20:]]
    messages.append({"role": "user", "content": question})

    llm = get_llm_provider()
    full_content = ""

    async for token in llm.generate_stream_with_history(RAG_SYSTEM_PROMPT, messages, context):
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
cd backend && uv run pytest tests/test_chat_service.py -v
```

Expected: 6 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/chat_service.py backend/tests/test_chat_service.py
git commit -m "feat: ask_question_stream 멀티턴 히스토리 전달 구현"
```

---

### Task 5: chat_service — ask_question(비스트리밍) 히스토리 연동

**Files:**
- Modify: `backend/app/services/chat_service.py:99-209`

- [ ] **Step 1: ask_question 수정**

`chat_service.py`의 `ask_question` 함수에서 다음 부분을 교체:

변경 전 (line 106-122):
```python
    user_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    await db.flush()

    relevant_chunks = await search_similar_chunks(db, question, top_k=5)

    context = "\n\n---\n\n".join(
        f"[{c['document_title']}] {c['content']}" for c in relevant_chunks
    )

    llm = get_llm_provider()
    answer = await llm.generate(RAG_SYSTEM_PROMPT, question, context)
```

변경 후:
```python
    history = await get_messages(db, session_id)

    user_msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=session_id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    await db.flush()

    relevant_chunks = await search_similar_chunks(db, question, top_k=5)

    context = "\n\n---\n\n".join(
        f"[{c['document_title']}] {c['content']}" for c in relevant_chunks
    )

    messages = [{"role": m.role, "content": m.content} for m in history[-20:]]
    messages.append({"role": "user", "content": question})

    llm = get_llm_provider()
    answer = await llm.generate_with_history(RAG_SYSTEM_PROMPT, messages, context)
```

- [ ] **Step 2: 테스트 실행 — 전체 PASS 확인**

```bash
cd backend && uv run pytest tests/test_chat_service.py -v
```

Expected: 6 passed

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/chat_service.py
git commit -m "feat: ask_question 비스트리밍도 멀티턴 히스토리 전달 구현"
```

---

### Task 6: 전체 테스트 확인

- [ ] **Step 1: 전체 테스트 실행**

```bash
cd backend && uv run pytest -v 2>&1 | tail -20
```

Expected: `test_chat_service.py` 6개 포함, 기존 실패(test_sr, test_change_impact, test_embedding, test_integration) 외 새 실패 없음

- [ ] **Step 2: 백엔드 재시작 후 위젯 데모에서 멀티턴 직접 확인**

1. `uv run fastapi dev` 실행
2. `http://localhost:5173/widget-demo` 접속
3. 첫 번째 메시지 전송: "안녕하세요"
4. 두 번째 메시지 전송: "방금 뭐라고 인사했어?" → LLM이 첫 번째 메시지를 기억하면 성공
