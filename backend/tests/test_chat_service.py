import asyncio
import pytest
from app.services.chat_service import _extract_sr_proposal, _strip_sr_block
from app.services.llm_service import MockLLMProvider


def test_extract_sr_proposal_returns_none_when_no_block():
    """정보 부족으로 LLM이 sr_proposal 블록을 포함하지 않은 경우."""
    response = "제목과 우선순위를 알려주세요. 어떤 변경이 필요하신가요?"
    assert _extract_sr_proposal(response) is None


def test_extract_sr_proposal_returns_data_when_block_present():
    """필수 정보 충족으로 LLM이 sr_proposal 블록을 포함한 경우."""
    response = """네, SR을 등록하겠습니다.

```sr_proposal
{"is_change_request": true, "title": "로그인 버튼 색상 변경", "description": "메인 페이지 로그인 버튼이 회색으로 표시됨", "priority": "medium", "target_document": "UI 가이드"}
```"""
    result = _extract_sr_proposal(response)
    assert result is not None
    assert result["title"] == "로그인 버튼 색상 변경"
    assert result["priority"] == "medium"


def test_strip_sr_block_removes_block():
    """_strip_sr_block이 사용자에게 보여줄 텍스트에서 sr_proposal 블록을 제거한다."""
    response = """SR을 등록했습니다.

```sr_proposal
{"is_change_request": true, "title": "테스트", "description": "설명", "priority": "low", "target_document": "doc"}
```"""
    result = _strip_sr_block(response)
    assert "sr_proposal" not in result
    assert "SR을 등록했습니다." in result


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
    assert "두 번째 질문" in result  # MockLLMProvider.generate는 user_message[:50]을 응답에 포함


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


@pytest.mark.asyncio
async def test_ask_question_stream_includes_history():
    """ask_question_stream은 이전 메시지를 포함한 messages 배열을 LLM에 전달한다."""
    from app.services.chat_service import ask_question_stream
    from unittest.mock import AsyncMock, MagicMock, patch
    import uuid

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


from app.services.llm_service import _prepend_context


def test_prepend_context_single_message():
    """단일 메시지(히스토리 없음): 현재 질문에 context가 붙는다."""
    messages = [{"role": "user", "content": "현재 질문"}]
    result = _prepend_context(messages, "문서 내용")
    assert result[0]["content"] == "Context from documentation:\n문서 내용\n\nUser question: 현재 질문"


def test_prepend_context_multi_turn():
    """멀티턴: context가 첫 번째가 아닌 마지막 user 메시지에 붙는다."""
    messages = [
        {"role": "user", "content": "이전 질문"},
        {"role": "assistant", "content": "이전 답변"},
        {"role": "user", "content": "현재 질문"},
    ]
    result = _prepend_context(messages, "문서 내용")
    assert result[0]["content"] == "이전 질문"  # 이전 질문은 그대로
    assert "문서 내용" in result[2]["content"]  # 마지막 user 메시지에 context 주입
    assert "현재 질문" in result[2]["content"]


def test_prepend_context_no_context():
    """context가 없으면 messages 복사본을 그대로 반환한다."""
    messages = [{"role": "user", "content": "질문"}]
    result = _prepend_context(messages, "")
    assert result == messages
    assert result is not messages  # 복사본이어야 함
