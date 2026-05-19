import pytest
import uuid
from unittest.mock import AsyncMock, MagicMock

from app.services.approval_service import review_doc_review_approval
from app.models.feedback import ApprovalRequest


def _mock_execute(return_value):
    """db.execute()가 반환하는 result mock을 만든다."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = return_value
    result.scalar_one.return_value = return_value
    execute_mock = AsyncMock(return_value=result)
    return execute_mock


@pytest.mark.asyncio
async def test_reject_doc_review_approval():
    """거부 시 approval.status=rejected, draft.status=done_no_proposal."""
    approval_id = uuid.uuid4()
    reviewer_id = uuid.uuid4()
    sr_draft_id = uuid.uuid4()

    mock_approval = ApprovalRequest(
        id=approval_id,
        approval_type="doc_review",
        sr_draft_id=sr_draft_id,
        status="pending",
    )

    mock_draft = type("SRDraft", (), {
        "id": sr_draft_id,
        "status": "pending_doc_review",
        "jira_issue_key": "TEST-1",
        "title": "테스트 SR",
        "description": "설명",
        "target_url": None,
    })()

    approval_result = MagicMock()
    approval_result.scalar_one_or_none.return_value = mock_approval

    draft_result = MagicMock()
    draft_result.scalar_one_or_none.return_value = mock_draft

    refreshed_result = MagicMock()
    refreshed_result.scalar_one.return_value = mock_approval

    db = AsyncMock()
    db.execute.side_effect = [approval_result, draft_result, refreshed_result]
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    result = await review_doc_review_approval(db, approval_id, reviewer_id, "reject")

    assert mock_approval.status == "rejected"
    assert mock_draft.status == "done_no_proposal"


@pytest.mark.asyncio
async def test_wrong_type_raises_error():
    """doc_review 타입이 아닌 approval을 거부해야 함."""
    approval_id = uuid.uuid4()
    reviewer_id = uuid.uuid4()

    mock_approval = ApprovalRequest(
        id=approval_id,
        approval_type="document_change",
        status="pending",
    )

    result = MagicMock()
    result.scalar_one_or_none.return_value = mock_approval

    db = AsyncMock()
    db.execute.return_value = result

    with pytest.raises(ValueError, match="doc_review"):
        await review_doc_review_approval(db, approval_id, reviewer_id, "reject")


@pytest.mark.asyncio
async def test_already_reviewed_raises_error():
    """이미 처리된 approval에 대해 오류를 발생시켜야 함."""
    approval_id = uuid.uuid4()
    reviewer_id = uuid.uuid4()

    mock_approval = ApprovalRequest(
        id=approval_id,
        approval_type="doc_review",
        status="rejected",
    )

    result = MagicMock()
    result.scalar_one_or_none.return_value = mock_approval

    db = AsyncMock()
    db.execute.return_value = result

    with pytest.raises(ValueError, match="already reviewed"):
        await review_doc_review_approval(db, approval_id, reviewer_id, "reject")
