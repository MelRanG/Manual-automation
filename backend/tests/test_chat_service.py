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
