from app.services.chat_service import _extract_sr_proposal, _strip_sr_block


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
