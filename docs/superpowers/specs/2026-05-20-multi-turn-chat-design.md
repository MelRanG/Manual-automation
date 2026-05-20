# 멀티턴 채팅 설계

**날짜:** 2026-05-20
**상태:** 승인됨

---

## 1. 목표

위젯 채팅(`/widget-demo`)과 일반 채팅(`/chat`) 모두에서 대화 히스토리를 LLM에 전달해 진정한 멀티턴 대화가 가능하도록 한다.

---

## 2. 현재 문제

`chat_service.ask_question_stream`이 매 요청마다 단일 메시지만 LLM에 전달한다. DB에는 이전 메시지가 저장돼 있지만 LLM context에 포함되지 않아 대화 연속성이 없다.

---

## 3. 설계

### 3-1. LLMProvider 인터페이스 확장

`messages` 배열(OpenAI 형식: `[{"role": "user"|"assistant", "content": "..."}]`)을 받는 메서드 추가:

```python
async def generate_with_history(
    self, system_prompt: str, messages: list[dict], context: str = ""
) -> str: ...

async def generate_stream_with_history(
    self, system_prompt: str, messages: list[dict], context: str = ""
) -> AsyncGenerator[str, None]: ...
```

각 Provider 구현:

| Provider | 방식 |
|----------|------|
| Bedrock | `client.messages.stream(messages=messages)` 네이티브 |
| Anthropic | `client.messages.stream(messages=messages)` 네이티브 |
| OpenAI | `chat.completions.create(messages=[system_msg] + messages)` 네이티브 |
| Mock | 마지막 user 메시지만 사용 (테스트용) |

RAG context는 첫 번째 user 메시지 content 앞에 붙여 전달한다:
```
Context from documentation:
{context}

User question: {original_question}
```

### 3-2. chat_service 변경

`ask_question_stream` 및 `ask_question` 공통:

1. `get_messages(db, session_id)`로 이전 메시지 로드
2. 최근 20개(`[-20:]`)로 슬라이싱 (토큰 비용 제어)
3. 현재 user 메시지를 배열에 추가
4. context가 있으면 마지막 user 메시지 content 앞에 prepend
5. `llm.generate_stream_with_history(system_prompt, messages)` 호출

### 3-3. 히스토리 제한

- 최근 **20개 메시지** (user + assistant 합산) 전달
- 이전 메시지는 `_strip_sr_block`이 적용된 `display_content`로 저장돼 있으므로 sr_proposal 블록 없이 전달됨

---

## 4. 변경 파일

- `backend/app/services/llm_service.py` — `generate_with_history`, `generate_stream_with_history` 추가 (LLMProvider, Bedrock, Anthropic, OpenAI, Mock 모두)
- `backend/app/services/chat_service.py` — `ask_question`, `ask_question_stream`에서 히스토리 로드 및 전달

## 5. 프론트엔드

변경 없음. API 계약 동일.

---

## 6. Out of Scope

- 히스토리 요약(summarization) — 20개 제한으로 충분
- 세션별 히스토리 초기화 UI
