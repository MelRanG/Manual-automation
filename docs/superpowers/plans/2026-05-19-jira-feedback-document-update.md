# Jira 완료 → 문서 자동 현행화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jira 이슈가 완료(Done) 상태로 전환될 때 AI가 SR 내용을 벡터 검색으로 관련 문서를 탐색하고, 선택적으로 Playwright로 대상 URL을 캡처한 뒤 문서 수정안을 생성해 기존 승인 워크플로우로 연결한다.

**Architecture:** Jira 웹훅 수신 즉시 200을 반환하고, BackgroundTasks로 `process_jira_done()` 를 실행한다. 이 함수가 벡터 검색 → Playwright 캡처(선택) → LLM 수정안 생성 → ProposedChange/ApprovalRequest 생성 → 알림을 순서대로 처리하며, 각 단계 실패는 다음 단계를 막지 않는다. 기존 `approval_service.review_approval()` 와 `document_service.create_new_version()` 은 변경 없이 재사용한다.

**Tech Stack:** FastAPI BackgroundTasks, pgvector cosine similarity, Playwright (선택적), AWS Bedrock Titan Embed v2, SQLAlchemy async, pytest + AsyncMock

**전제:** 로컬 master에 이미 Jira 양방향 연동(`app/routers/jira.py`, `app/models/jira.py`, `app/services/jira_service.py`)이 구현되어 있다. 이 플랜은 그 위에 추가한다.

---

## 파일 구조

| 상태 | 파일 | 변경 내용 |
|---|---|---|
| 수정 | `backend/app/models/sr.py` | SRDraft에 `target_url` 추가 |
| 수정 | `backend/app/schemas/sr.py` | SRDraftCreate/Response에 `target_url` 추가 |
| 수정 | `backend/app/models/jira.py` | JiraCallbackLog에 `error_message` 추가 |
| 수정 | `backend/app/schemas/jira.py` | JiraCallbackLogResponse에 `error_message` 추가 |
| 수정 | `backend/app/services/embedding_service.py` | BedrockEmbeddingProvider 추가 |
| 수정 | `backend/app/routers/jira.py` | 웹훅 핸들러를 BackgroundTasks 방식으로 변경 |
| 수정 | `backend/app/services/jira_service.py` | `process_jira_done()` 추가 |
| 수정 | `backend/app/services/sr_service.py` | `create_sr_draft()`에 `target_url` 반영 |
| 생성 | `backend/alembic/versions/xxxx_jira_sr_update.py` | DB 마이그레이션 |
| 수정 | `backend/tests/test_jira.py` | 새 테스트 추가 |
| 생성 | `backend/tests/test_embedding.py` | Bedrock provider 테스트 |

---

## Task 1: 모델/스키마 필드 추가 + 마이그레이션

**Files:**
- Modify: `backend/app/models/sr.py`
- Modify: `backend/app/schemas/sr.py`
- Modify: `backend/app/models/jira.py`
- Modify: `backend/app/schemas/jira.py`

- [ ] **Step 1: SRDraft 모델에 target_url 추가**

`backend/app/models/sr.py` 의 `SRDraft` 클래스에 추가:

```python
target_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
```

`String` import는 이미 있으므로 추가 불필요.

- [ ] **Step 2: SRDraft 스키마 업데이트**

`backend/app/schemas/sr.py` 의 `SRDraftCreate` 에 추가:
```python
target_url: str | None = None
```

`SRDraftResponse` 에 추가:
```python
target_url: str | None = None
```

- [ ] **Step 3: JiraCallbackLog 모델에 error_message 추가**

`backend/app/models/jira.py` 의 `JiraCallbackLog` 클래스에 추가:

```python
error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
```

`Text` import는 이미 있으므로 추가 불필요.

- [ ] **Step 4: JiraCallbackLogResponse 스키마 업데이트**

`backend/app/schemas/jira.py` 의 `JiraCallbackLogResponse` 에 추가:
```python
error_message: str | None = None
```

- [ ] **Step 5: 마이그레이션 생성**

```bash
cd backend && uv run alembic revision --autogenerate -m "add target_url to sr_drafts and error_message to jira_callback_logs"
```

생성된 파일을 열어 `sr_drafts.target_url`, `jira_callback_logs.error_message` 두 컬럼이 추가되는 것 확인.

- [ ] **Step 6: 마이그레이션 적용**

```bash
cd backend && uv run alembic upgrade head
```

Expected: `Running upgrade ... -> xxxx`

- [ ] **Step 7: 커밋**

```bash
git add backend/app/models/sr.py backend/app/schemas/sr.py backend/app/models/jira.py backend/app/schemas/jira.py backend/alembic/versions/
git commit -m "feat: SRDraft.target_url, JiraCallbackLog.error_message 필드 추가"
```

---

## Task 2: BedrockEmbeddingProvider 추가

**Files:**
- Modify: `backend/app/services/embedding_service.py`
- Create: `backend/tests/test_embedding.py`

- [ ] **Step 1: 테스트 먼저 작성**

`backend/tests/test_embedding.py` 생성:

```python
from unittest.mock import patch
from app.services.embedding_service import get_embedding_provider, BedrockEmbeddingProvider, MockEmbeddingProvider


def test_get_provider_mock():
    with patch("app.services.embedding_service.settings") as mock_settings:
        mock_settings.embedding_model = "mock"
        provider = get_embedding_provider()
    assert isinstance(provider, MockEmbeddingProvider)


def test_get_provider_bedrock():
    with patch("app.services.embedding_service.settings") as mock_settings:
        mock_settings.embedding_model = "bedrock"
        mock_settings.aws_region = "us-east-1"
        mock_settings.aws_access_key_id = "key"
        mock_settings.aws_secret_access_key = "secret"
        provider = get_embedding_provider()
    assert isinstance(provider, BedrockEmbeddingProvider)
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_embedding.py -v
```

Expected: `FAILED` — `cannot import name 'BedrockEmbeddingProvider'`

- [ ] **Step 3: BedrockEmbeddingProvider 구현**

`backend/app/services/embedding_service.py` 에 클래스 추가:

```python
class BedrockEmbeddingProvider(EmbeddingProvider):
    def __init__(self):
        import boto3
        from app.config import settings as _settings
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=_settings.aws_region,
            aws_access_key_id=_settings.aws_access_key_id or None,
            aws_secret_access_key=_settings.aws_secret_access_key or None,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        import json
        import asyncio

        def _embed_one(text: str) -> list[float]:
            body = json.dumps({"inputText": text})
            resp = self.client.invoke_model(
                modelId="amazon.titan-embed-text-v2:0",
                body=body,
                contentType="application/json",
                accept="application/json",
            )
            return json.loads(resp["body"].read())["embedding"]

        loop = asyncio.get_event_loop()
        results = []
        for text in texts:
            vec = await loop.run_in_executor(None, _embed_one, text)
            results.append(vec)
        return results
```

`get_embedding_provider()` 에 분기 추가:

```python
def get_embedding_provider() -> EmbeddingProvider:
    if settings.embedding_model == "bedrock":
        return BedrockEmbeddingProvider()
    if settings.embedding_model == "openai":
        return OpenAIEmbeddingProvider()
    return MockEmbeddingProvider()
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_embedding.py -v
```

Expected: 2개 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/embedding_service.py backend/tests/test_embedding.py
git commit -m "feat: BedrockEmbeddingProvider 추가 (amazon.titan-embed-text-v2:0)"
```

---

## Task 3: process_jira_done() — 관련 문서 탐색

**Files:**
- Modify: `backend/app/services/jira_service.py`
- Modify: `backend/tests/test_jira.py`

기존 `jira_service.py` 의 웹훅 처리 로직(직접 피드백 생성 방식)을 BackgroundTasks 방식으로 교체하고, `process_jira_done()` 에서 벡터 검색으로 관련 문서를 탐색한다.

- [ ] **Step 1: 기존 test_jira.py 확인**

```bash
cat backend/tests/test_jira.py
```

기존 테스트 목록 파악 후, 아래 테스트를 **추가**한다.

- [ ] **Step 2: 관련 문서 없을 때 테스트 추가**

`backend/tests/test_jira.py` 에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_no_related_docs(db_session):
    """관련 문서가 없으면 log.status == skipped_no_docs"""
    import uuid
    from unittest.mock import patch
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.services import jira_service

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        title="테스트 SR",
        description="설명",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        target_url=None,
    )
    db_session.add(sr)
    log = JiraCallbackLog(
        id=uuid.uuid4(),
        jira_issue_key="TEST-100",
        event_type="jira:issue_updated",
        payload={},
        status="pending",
        sr_draft_id=sr.id,
    )
    db_session.add(log)
    await db_session.commit()

    with patch("app.services.jira_service.search_similar_chunks", return_value=[]):
        await jira_service.process_jira_done(sr.id, log.id)

    await db_session.refresh(log)
    assert log.status == "skipped_no_docs"
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_jira.py::test_process_jira_done_no_related_docs -v
```

Expected: `FAILED` — `process_jira_done` 미존재

- [ ] **Step 4: process_jira_done() 1단계 구현 (문서 탐색까지)**

`backend/app/services/jira_service.py` 에 추가. 기존 웹훅 핸들러 내부의 피드백 직접 생성 코드는 건드리지 않고 `process_jira_done` 함수만 새로 추가한다:

```python
import logging
from app.db import SessionLocal
from app.services.search_service import search_similar_chunks

logger = logging.getLogger(__name__)

DISTANCE_THRESHOLD = 0.6


async def _find_related_documents(db, query: str) -> list[dict]:
    """벡터 검색으로 관련 문서 탐색. 실패 시 제목 키워드 매칭으로 폴백."""
    from app.models.document import Document
    from sqlalchemy import select, or_

    try:
        chunks = await search_similar_chunks(db, query, top_k=10)
        seen: set[str] = set()
        docs = []
        for c in chunks:
            if c["distance"] is not None and c["distance"] > DISTANCE_THRESHOLD:
                continue
            doc_id = str(c["document_id"])
            if doc_id not in seen:
                seen.add(doc_id)
                docs.append(c)
                if len(docs) >= 3:
                    break
        if docs:
            return docs
    except Exception as e:
        logger.warning(f"벡터 검색 실패, 키워드 폴백: {e}")

    keywords = query.split()[:5]
    conditions = [Document.title.ilike(f"%{kw}%") for kw in keywords]
    result = await db.execute(
        select(Document)
        .where(Document.status == "active")
        .where(or_(*conditions))
        .limit(3)
    )
    fallback_docs = result.scalars().all()
    return [
        {"document_id": d.id, "document_title": d.title, "content": "", "distance": None}
        for d in fallback_docs
    ]


async def process_jira_done(sr_id: uuid.UUID, log_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        sr_result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
        sr = sr_result.scalar_one_or_none()
        log_result = await db.execute(select(JiraCallbackLog).where(JiraCallbackLog.id == log_id))
        log = log_result.scalar_one_or_none()
        if not sr or not log:
            return

        try:
            query = f"{sr.title} {sr.description}"
            related_docs = await _find_related_documents(db, query)

            if not related_docs:
                log.status = "skipped_no_docs"
                await db.commit()
                return

            sr.related_document_ids = [str(d["document_id"]) for d in related_docs]
            await db.flush()

            # 이후 단계 (Task 4에서 구현)
            log.status = "processed"
            await db.commit()

        except Exception as e:
            logger.error(f"process_jira_done 실패 sr={sr_id}: {e}")
            log.status = "failed"
            log.error_message = str(e)[:500]
            await db.commit()
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_jira.py -v
```

Expected: 전체 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/jira_service.py backend/tests/test_jira.py
git commit -m "feat: process_jira_done — 벡터 검색 + 키워드 폴백으로 관련 문서 탐색"
```

---

## Task 4: process_jira_done() — Playwright 캡처 + LLM 수정안 생성

**Files:**
- Modify: `backend/app/services/jira_service.py`
- Modify: `backend/tests/test_jira.py`

- [ ] **Step 1: 수정안 생성 테스트 추가**

`backend/tests/test_jira.py` 에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_creates_proposals(db_session):
    """관련 문서가 있으면 ProposedChange + ApprovalRequest 생성"""
    import uuid
    from unittest.mock import patch
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.models.document import Document, DocumentVersion
    from app.models.feedback import ProposedDocumentChange, ApprovalRequest
    from app.services import jira_service
    from sqlalchemy import select

    doc = Document(
        id=uuid.uuid4(), title="테스트 문서", description="설명",
        owner_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        status="active", priority="medium", trust_score=1.0,
    )
    db_session.add(doc)
    await db_session.flush()

    version = DocumentVersion(
        id=uuid.uuid4(), document_id=doc.id, version_number=1,
        content="기존 문서 내용",
        created_by=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        change_summary="초기",
    )
    db_session.add(version)
    await db_session.flush()
    doc.current_version_id = version.id

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        title="기능 개선 요청", description="로그인 버튼 위치 변경",
        priority="medium", status="submitted",
        created_by_ai=False, target_url=None,
    )
    db_session.add(sr)
    log = JiraCallbackLog(
        id=uuid.uuid4(), jira_issue_key="TEST-200",
        event_type="jira:issue_updated", payload={},
        status="pending", sr_draft_id=sr.id,
    )
    db_session.add(log)
    await db_session.commit()

    mock_chunk = {
        "document_id": doc.id, "document_title": doc.title,
        "content": "기존 문서 내용", "distance": 0.2,
    }

    with patch("app.services.jira_service.search_similar_chunks", return_value=[mock_chunk]):
        await jira_service.process_jira_done(sr.id, log.id)

    await db_session.refresh(log)
    assert log.status == "processed"

    proposals = (await db_session.execute(
        select(ProposedDocumentChange).where(ProposedDocumentChange.document_id == doc.id)
    )).scalars().all()
    assert len(proposals) == 1
    assert proposals[0].source_type == "jira_sr"

    approvals = (await db_session.execute(
        select(ApprovalRequest).where(ApprovalRequest.proposed_change_id == proposals[0].id)
    )).scalars().all()
    assert len(approvals) == 1
```

- [ ] **Step 2: target_url 없을 때 Playwright 미호출 테스트 추가**

`backend/tests/test_jira.py` 에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_no_playwright_without_target_url(db_session):
    """target_url 없으면 capture_screenshots 미호출"""
    import uuid
    from unittest.mock import patch
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.models.document import Document, DocumentVersion
    from app.services import jira_service

    doc = Document(
        id=uuid.uuid4(), title="문서3", description="설명",
        owner_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        status="active", priority="medium", trust_score=1.0,
    )
    db_session.add(doc)
    await db_session.flush()
    version = DocumentVersion(
        id=uuid.uuid4(), document_id=doc.id, version_number=1,
        content="내용", created_by=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        change_summary="초기",
    )
    db_session.add(version)
    await db_session.flush()
    doc.current_version_id = version.id

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        title="SR no url", description="설명",
        priority="medium", status="submitted",
        created_by_ai=False, target_url=None,
    )
    db_session.add(sr)
    log = JiraCallbackLog(
        id=uuid.uuid4(), jira_issue_key="TEST-300",
        event_type="jira:issue_updated", payload={},
        status="pending", sr_draft_id=sr.id,
    )
    db_session.add(log)
    await db_session.commit()

    mock_chunk = {
        "document_id": doc.id, "document_title": doc.title,
        "content": "내용", "distance": 0.1,
    }

    with patch("app.services.jira_service.search_similar_chunks", return_value=[mock_chunk]), \
         patch("app.services.jira_service.capture_screenshots") as mock_capture:
        await jira_service.process_jira_done(sr.id, log.id)
        mock_capture.assert_not_called()
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_jira.py::test_process_jira_done_creates_proposals tests/test_jira.py::test_process_jira_done_no_playwright_without_target_url -v
```

Expected: `FAILED`

- [ ] **Step 4: process_jira_done() 완성 — Playwright + LLM 수정안 생성**

`backend/app/services/jira_service.py` 의 `process_jira_done()` 에서 `sr.related_document_ids` 업데이트 이후 `log.status = "processed"` 부분을 아래로 교체:

```python
            # Playwright 캡처 (target_url 있을 때만)
            page_context = ""
            if sr.target_url:
                try:
                    from app.services.manual_service import capture_screenshots
                    from app.models.manual import ManualGenerationJob
                    mock_job = ManualGenerationJob(
                        target_url=sr.target_url,
                        login_id=None, login_pw=None,
                        login_url=None, scenario_steps=None,
                    )
                    screenshots = await capture_screenshots(mock_job)
                    page_context = "\n".join(
                        s.get("page_text", "")[:500]
                        for s in screenshots if s.get("page_text")
                    )
                except Exception as e:
                    logger.warning(f"Playwright 캡처 스킵 (sr={sr_id}): {e}")

            # 각 문서마다 수정안 생성
            from app.services.llm_service import get_llm_provider
            from app.models.feedback import ProposedDocumentChange, ApprovalRequest
            from app.models.document import Document, DocumentVersion

            llm = get_llm_provider()
            proposals_created = 0

            for doc_info in related_docs:
                try:
                    doc_id = uuid.UUID(str(doc_info["document_id"]))
                    ver_result = await db.execute(
                        select(DocumentVersion)
                        .join(Document, Document.current_version_id == DocumentVersion.id)
                        .where(Document.id == doc_id)
                    )
                    version = ver_result.scalar_one_or_none()
                    if not version:
                        continue
                    original = version.content

                    prompt = f"""다음 서비스 요청(SR)이 Jira에서 완료되었습니다.
SR 제목: {sr.title}
SR 설명: {sr.description}

현재 문서 내용:
{original[:3000]}
"""
                    if page_context:
                        prompt += f"\n현재 시스템 화면 텍스트:\n{page_context[:1000]}"
                    prompt += "\n\n위 SR 내용을 반영해 문서를 수정한 전체 내용을 작성하세요."

                    proposed_text = await llm.generate(
                        "당신은 기술 문서 작가입니다. SR 완료 내용을 반영해 문서를 현행화합니다.",
                        prompt,
                    )

                    change = ProposedDocumentChange(
                        id=uuid.uuid4(),
                        feedback_report_id=None,
                        document_id=doc_id,
                        document_version_id=version.id,
                        manual_job_id=None,
                        original_text=original,
                        proposed_text=proposed_text,
                        diff="",
                        reasoning=f"Jira SR 완료: {sr.title}",
                        confidence=0.8,
                        source_type="jira_sr",
                        status="pending",
                    )
                    db.add(change)
                    await db.flush()

                    approval = ApprovalRequest(
                        id=uuid.uuid4(),
                        proposed_change_id=change.id,
                        status="pending",
                    )
                    db.add(approval)
                    proposals_created += 1

                except Exception as e:
                    logger.warning(f"문서 {doc_info['document_id']} 수정안 생성 실패: {e}")

            if proposals_created > 0:
                from app.routers.notifications import create_notification
                from app.models.user import User
                admin_result = await db.execute(
                    select(User).where(User.role == "admin").limit(1)
                )
                admin = admin_result.scalar_one_or_none()
                if admin:
                    await create_notification(
                        db,
                        user_id=admin.id,
                        type="jira_sr_proposals_ready",
                        title=f"SR '{sr.title}' 완료 — 문서 수정안 {proposals_created}건 생성",
                        message="Approvals 페이지에서 검토하세요.",
                        document_id=None,
                    )

            sr.status = "done_synced" if proposals_created > 0 else "done_no_proposal"
            log.status = "processed"
            await db.commit()
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_jira.py -v
```

Expected: 전체 PASS

- [ ] **Step 6: 전체 테스트 실행**

```bash
cd backend && uv run pytest -v
```

Expected: 기존 테스트 포함 전체 PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/app/services/jira_service.py backend/tests/test_jira.py
git commit -m "feat: process_jira_done — Playwright 캡처 + LLM 수정안 + Approval 자동 생성"
```

---

## Task 5: 웹훅 라우터 BackgroundTasks 방식으로 교체 + sr_service 업데이트

**Files:**
- Modify: `backend/app/routers/jira.py`
- Modify: `backend/app/services/sr_service.py`

기존 웹훅 라우터가 동기적으로 피드백을 생성하는 코드를 `BackgroundTasks` 방식으로 교체한다.

- [ ] **Step 1: 기존 웹훅 라우터 확인**

```bash
cat backend/app/routers/jira.py
```

`receive_jira_webhook()` 함수 내부의 피드백 직접 생성 부분을 파악한다.

- [ ] **Step 2: 웹훅 핸들러 교체**

`backend/app/routers/jira.py` 의 `receive_jira_webhook()` 함수를 아래로 교체:

```python
@router.post("/webhook")
async def receive_jira_webhook(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    issue_key = payload.get("issue", {}).get("key", "unknown")
    event_type = payload.get("webhookEvent", "unknown")

    log = JiraCallbackLog(
        id=uuid.uuid4(),
        jira_issue_key=issue_key,
        event_type=event_type,
        payload=payload,
        status="pending",
    )
    db.add(log)

    config = await jira_service.get_active_config(db)

    if not config or not jira_service.is_done_transition(config, payload):
        log.status = "skipped"
        await db.commit()
        return {"status": "skipped"}

    sr_result = await db.execute(
        select(SRDraft).where(SRDraft.jira_issue_key == issue_key)
    )
    draft = sr_result.scalar_one_or_none()

    if not draft:
        log.status = "skipped"
        await db.commit()
        return {"status": "skipped", "reason": "no SR found for issue key"}

    log.sr_draft_id = draft.id
    await db.commit()

    background_tasks.add_task(jira_service.process_jira_done, draft.id, log.id)
    return {"status": "processing", "sr_id": str(draft.id)}
```

라우터 함수 시그니처에 `BackgroundTasks` 파라미터가 추가되므로 import도 확인:
```python
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
```

또한 `SRDraft` 모델 import가 필요:
```python
from app.models.sr import SRDraft
```

- [ ] **Step 3: sr_service.py create_sr_draft에 target_url 반영**

`backend/app/services/sr_service.py` 의 `create_sr_draft()` 내 `SRDraft(...)` 생성에 추가:

```python
target_url=data.target_url,
```

- [ ] **Step 4: 전체 테스트 실행**

```bash
cd backend && uv run pytest -v
```

Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/routers/jira.py backend/app/services/sr_service.py
git commit -m "feat: 웹훅 핸들러 BackgroundTasks 방식 전환, SR target_url 저장 반영"
```

---

## Self-Review

**스펙 커버리지:**
- [x] SRDraft.target_url 추가 → Task 1
- [x] JiraCallbackLog.error_message 추가 → Task 1
- [x] BedrockEmbeddingProvider → Task 2
- [x] 웹훅 → BackgroundTasks 즉시 응답 → Task 5
- [x] 벡터 검색 + 키워드 폴백 → Task 3
- [x] Playwright 캡처 선택적 실행 → Task 4
- [x] LLM 수정안 + ProposedChange + ApprovalRequest 생성 → Task 4
- [x] 관리자 알림 → Task 4
- [x] 관련 문서 0건 시 skipped_no_docs → Task 3
- [x] target_url 없을 때 Playwright 미호출 → Task 4
- [x] sr_service target_url 저장 → Task 5

**타입 일관성:**
- `process_jira_done(sr_id: uuid.UUID, log_id: uuid.UUID)` — Task 3 서비스, Task 4 완성, Task 5 라우터 호출 모두 동일 시그니처
- `SRDraft.target_url` — Task 1 모델, Task 1 스키마, Task 5 sr_service 일관성 확인
- `ProposedDocumentChange.source_type = "jira_sr"` — Task 4 구현, Task 4 테스트 assert 일치
