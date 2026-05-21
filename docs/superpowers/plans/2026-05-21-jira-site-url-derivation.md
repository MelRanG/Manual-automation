# Jira Site URL Derivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-entered `base_url` with `site_url` input that derives the service-account `base_url` via Atlassian's `/_edge/tenant_info`, and rebuild SR `jira_issue_url` dynamically at response time so existing broken rows self-heal.

**Architecture:**
Backend `jira_service` gains pure helpers (`normalize_site_url`, `derive_base_url`, `build_jira_issue_url`) and one async helper pair (`_fetch_tenant_info` + `resolve_cloud_id`) that calls Atlassian's public tenant-info endpoint. The Jira config upsert/test routers call derive before persisting. SR router endpoints route ORM drafts through a new `sr_service.build_sr_response(s)` helper that injects a freshly computed `jira_issue_url` into the Pydantic response. Frontend `WebhookLogs.tsx` swaps the `base_url` input for a `site_url` input and shows the server-derived `base_url` read-only.

**Tech Stack:** FastAPI, SQLAlchemy 2 (Mapped/async), Alembic, Pydantic v2, aiohttp, React + Vite + TypeScript, pytest-asyncio + unittest.mock + httpx AsyncClient.

**Spec:** `docs/superpowers/specs/2026-05-21-jira-site-url-derivation-design.md`

---

## File Structure

**Backend — modify:**
- `backend/app/models/jira.py` — add `site_url` column.
- `backend/app/schemas/jira.py` — `JiraConfigUpsert` drops `base_url`, adds `site_url`; `JiraConfigResponse` adds `site_url`.
- `backend/app/services/jira_service.py` — add 4 helpers + 1 async fetcher; remove URL construction inside `create_jira_issue`.
- `backend/app/services/sr_service.py` — stop writing `jira_issue_url`; add `build_sr_response` / `build_sr_responses`.
- `backend/app/routers/jira.py` — upsert/test endpoints derive `base_url` from `site_url`; success message includes cloudId.
- `backend/app/routers/sr.py` — all SR-returning endpoints use new response builders.

**Backend — create:**
- `backend/alembic/versions/<new>_add_site_url_to_jira_configs.py` — adds `site_url` column + backfill.
- `backend/tests/test_jira_helpers.py` — unit tests for the new pure + async helpers.
- `backend/tests/test_jira_config_router.py` — integration tests for upsert/test endpoints with mocked derive.
- `backend/tests/test_sr_jira_url.py` — integration tests that SR responses use the freshly computed URL.

**Frontend — modify:**
- `frontend/src/lib/api.ts` — `JiraConfig` adds `site_url`; `saveJiraConfig`/`testJiraConfig` payload shape switches `base_url → site_url`.
- `frontend/src/pages/WebhookLogs.tsx` — replace `base_url` input with `site_url` input + read-only derived `base_url` display.

---

## Task 1: Add `site_url` column to JiraConfig model + Alembic migration

**Files:**
- Modify: `backend/app/models/jira.py`
- Create: `backend/alembic/versions/<new_rev>_add_site_url_to_jira_configs.py`

- [ ] **Step 1: Add `site_url` field to the SQLAlchemy model**

In `backend/app/models/jira.py`, locate the `JiraConfig` class (around lines 10-18) and add `site_url` immediately above `base_url`:

```python
class JiraConfig(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "jira_configs"

    site_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    base_url: Mapped[str] = mapped_column(String(500))
    user_email: Mapped[str] = mapped_column(String(255))
    api_token: Mapped[str] = mapped_column(Text)
    project_key: Mapped[str] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    trigger_status_names: Mapped[list | None] = mapped_column(JSONB, nullable=True)
```

- [ ] **Step 2: Generate the Alembic migration**

From repo root:

```bash
cd backend && uv run alembic revision -m "add site_url to jira_configs"
```

Note the generated filename printed (e.g., `backend/alembic/versions/abc123def456_add_site_url_to_jira_configs.py`).

- [ ] **Step 3: Fill in the migration body**

Replace the entire file content (preserving the `revision`/`down_revision` values auto-generated; substitute `<NEW_REV>` and `<PARENT_REV>` with what Alembic produced):

```python
"""add site_url to jira_configs

Revision ID: <NEW_REV>
Revises: <PARENT_REV>
Create Date: 2026-05-21 ...
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "<NEW_REV>"
down_revision: Union[str, Sequence[str], None] = "<PARENT_REV>"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jira_configs",
        sa.Column("site_url", sa.String(length=500), nullable=True),
    )
    # Backfill: rows whose base_url is a normal Atlassian site URL get site_url = base_url.
    # Service-account rows (base_url like https://api.atlassian.com/...) are left NULL;
    # the user must re-enter site URL in settings to restore browse links.
    op.execute(
        """
        UPDATE jira_configs
           SET site_url = base_url
         WHERE base_url NOT LIKE 'https://api.atlassian.com/%'
           AND base_url NOT LIKE 'http://api.atlassian.com/%';
        """
    )


def downgrade() -> None:
    op.drop_column("jira_configs", "site_url")
```

- [ ] **Step 4: Apply the migration locally**

```bash
cd backend && uv run alembic upgrade head
```

Expected: no error; final line shows the new revision.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/jira.py backend/alembic/versions/*add_site_url_to_jira_configs.py
git commit -m "feat(backend): add site_url column to jira_configs"
```

---

## Task 2: Update Pydantic schemas — drop `base_url` from upsert, add `site_url`

**Files:**
- Modify: `backend/app/schemas/jira.py`

- [ ] **Step 1: Read existing schemas to confirm field set**

```bash
cat backend/app/schemas/jira.py
```

You should see `JiraConfigUpsert` (with `base_url`, `user_email`, `api_token`, `project_key`, `is_active`, `trigger_status_names`) and `JiraConfigResponse` (same plus `id`, `api_token_masked`, `updated_at`).

- [ ] **Step 2: Replace `base_url` with `site_url` in `JiraConfigUpsert`, and add both fields to `JiraConfigResponse`**

Apply these edits:

```python
class JiraConfigUpsert(BaseModel):
    site_url: str
    user_email: str
    api_token: str | None = None
    project_key: str
    is_active: bool = True
    trigger_status_names: list[str] | None = None


class JiraConfigResponse(BaseModel):
    id: uuid.UUID
    site_url: str | None
    base_url: str  # server-derived (read-only from client perspective)
    user_email: str
    api_token_masked: str
    project_key: str
    is_active: bool
    trigger_status_names: list[str] | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

Keep existing imports and other schemas in the file untouched. If `api_token` was previously required on `JiraConfigUpsert`, the existing test router code at `backend/app/routers/jira.py:56-70` already tolerates an empty `api_token` by reusing the stored one, so making it optional matches reality.

- [ ] **Step 3: Confirm imports compile**

```bash
cd backend && uv run python -c "from app.schemas.jira import JiraConfigUpsert, JiraConfigResponse; print('ok')"
```

Expected output: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/jira.py
git commit -m "feat(backend): swap base_url for site_url in JiraConfigUpsert; expose site_url on response"
```

---

## Task 3: Add pure helpers `normalize_site_url` and `derive_base_url`

**Files:**
- Modify: `backend/app/services/jira_service.py`
- Create: `backend/tests/test_jira_helpers.py`

- [ ] **Step 1: Write failing unit tests**

Create `backend/tests/test_jira_helpers.py`:

```python
import pytest

from app.services.jira_service import (
    build_jira_issue_url,
    derive_base_url,
    normalize_site_url,
)


def test_normalize_site_url_strips_trailing_slash():
    assert normalize_site_url("https://x.atlassian.net/") == "https://x.atlassian.net"


def test_normalize_site_url_keeps_no_trailing_slash():
    assert normalize_site_url("https://x.atlassian.net") == "https://x.atlassian.net"


def test_normalize_site_url_adds_https_when_missing_scheme():
    assert normalize_site_url("x.atlassian.net") == "https://x.atlassian.net"


def test_normalize_site_url_forces_https_from_http():
    assert normalize_site_url("http://x.atlassian.net") == "https://x.atlassian.net"


def test_normalize_site_url_strips_whitespace():
    assert normalize_site_url("  https://x.atlassian.net  ") == "https://x.atlassian.net"


def test_derive_base_url():
    assert (
        derive_base_url("7b4ffc68-2983-46cb-b50f-5f2ef43a6a57")
        == "https://api.atlassian.com/ex/jira/7b4ffc68-2983-46cb-b50f-5f2ef43a6a57"
    )
```

(`build_jira_issue_url` import will fail until Task 4 — that's expected; we'll add the symbol then.)

- [ ] **Step 2: Run tests to see import-level + assertion failures**

```bash
cd backend && uv run pytest tests/test_jira_helpers.py -v
```

Expected: collection or test errors (helpers not defined yet).

- [ ] **Step 3: Implement the helpers**

In `backend/app/services/jira_service.py`, add these near the top (after existing imports, before `_auth_header`):

```python
def normalize_site_url(raw: str) -> str:
    """Strip whitespace + trailing slash, force https scheme."""
    s = raw.strip().rstrip("/")
    if s.startswith("http://"):
        s = "https://" + s[len("http://"):]
    elif not s.startswith("https://"):
        s = "https://" + s
    return s


def derive_base_url(cloud_id: str) -> str:
    """Service-account API URL for a given Atlassian cloudId."""
    return f"https://api.atlassian.com/ex/jira/{cloud_id}"
```

- [ ] **Step 4: Run the helper tests (other ones still red until Task 4)**

```bash
cd backend && uv run pytest tests/test_jira_helpers.py::test_normalize_site_url_strips_trailing_slash tests/test_jira_helpers.py::test_normalize_site_url_keeps_no_trailing_slash tests/test_jira_helpers.py::test_normalize_site_url_adds_https_when_missing_scheme tests/test_jira_helpers.py::test_normalize_site_url_forces_https_from_http tests/test_jira_helpers.py::test_normalize_site_url_strips_whitespace tests/test_jira_helpers.py::test_derive_base_url -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/jira_service.py backend/tests/test_jira_helpers.py
git commit -m "feat(backend): add normalize_site_url and derive_base_url helpers"
```

---

## Task 4: Add `build_jira_issue_url` helper

**Files:**
- Modify: `backend/app/services/jira_service.py`
- Modify: `backend/tests/test_jira_helpers.py`

- [ ] **Step 1: Append failing tests for `build_jira_issue_url`**

Append to `backend/tests/test_jira_helpers.py`:

```python
from types import SimpleNamespace


def _config(site_url):
    return SimpleNamespace(site_url=site_url)


def test_build_jira_issue_url_normal():
    assert (
        build_jira_issue_url("SCRUM-178", _config("https://x.atlassian.net"))
        == "https://x.atlassian.net/browse/SCRUM-178"
    )


def test_build_jira_issue_url_strips_trailing_slash():
    assert (
        build_jira_issue_url("SCRUM-1", _config("https://x.atlassian.net/"))
        == "https://x.atlassian.net/browse/SCRUM-1"
    )


def test_build_jira_issue_url_none_when_key_missing():
    assert build_jira_issue_url(None, _config("https://x.atlassian.net")) is None


def test_build_jira_issue_url_none_when_config_missing():
    assert build_jira_issue_url("SCRUM-1", None) is None


def test_build_jira_issue_url_none_when_site_url_missing():
    assert build_jira_issue_url("SCRUM-1", _config(None)) is None


def test_build_jira_issue_url_none_for_local_key():
    assert (
        build_jira_issue_url("LOCAL-ABCD1234", _config("https://x.atlassian.net"))
        is None
    )
```

- [ ] **Step 2: Run tests to verify failures**

```bash
cd backend && uv run pytest tests/test_jira_helpers.py -k build_jira_issue_url -v
```

Expected: errors / failures (function not defined).

- [ ] **Step 3: Implement `build_jira_issue_url`**

Add to `backend/app/services/jira_service.py` (next to the other pure helpers from Task 3). Use a string-typed local rather than importing `JiraConfig` to keep the helper safe to call with a duck-typed object in tests:

```python
def build_jira_issue_url(jira_issue_key, config) -> str | None:
    """Compose the sit-URL browse link, returning None when prerequisites are missing
    or the key is a local-simulation key."""
    if not jira_issue_key or config is None:
        return None
    site_url = getattr(config, "site_url", None)
    if not site_url:
        return None
    if jira_issue_key.startswith("LOCAL-"):
        return None
    return f"{site_url.rstrip('/')}/browse/{jira_issue_key}"
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd backend && uv run pytest tests/test_jira_helpers.py -v
```

Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/jira_service.py backend/tests/test_jira_helpers.py
git commit -m "feat(backend): add build_jira_issue_url helper"
```

---

## Task 5: Add async `resolve_cloud_id` (and a thin `_fetch_tenant_info` it wraps)

**Files:**
- Modify: `backend/app/services/jira_service.py`
- Modify: `backend/tests/test_jira_helpers.py`

- [ ] **Step 1: Append failing async tests**

Append to `backend/tests/test_jira_helpers.py`:

```python
from unittest.mock import AsyncMock, patch

from app.services import jira_service


@pytest.mark.asyncio(loop_scope="session")
async def test_resolve_cloud_id_success():
    with patch.object(
        jira_service,
        "_fetch_tenant_info",
        AsyncMock(return_value={"cloudId": "abc-123", "cloudName": "x"}),
    ):
        assert await jira_service.resolve_cloud_id("https://x.atlassian.net") == "abc-123"


@pytest.mark.asyncio(loop_scope="session")
async def test_resolve_cloud_id_missing_field():
    with patch.object(
        jira_service,
        "_fetch_tenant_info",
        AsyncMock(return_value={"cloudName": "x"}),
    ):
        with pytest.raises(ValueError, match="cloudId"):
            await jira_service.resolve_cloud_id("https://x.atlassian.net")


@pytest.mark.asyncio(loop_scope="session")
async def test_resolve_cloud_id_http_error():
    with patch.object(
        jira_service,
        "_fetch_tenant_info",
        AsyncMock(side_effect=RuntimeError("HTTP 404")),
    ):
        with pytest.raises(ValueError, match="tenant_info"):
            await jira_service.resolve_cloud_id("https://x.atlassian.net")


@pytest.mark.asyncio(loop_scope="session")
async def test_resolve_cloud_id_normalizes_input():
    captured = {}

    async def fake(site_url):
        captured["site_url"] = site_url
        return {"cloudId": "abc-123"}

    with patch.object(jira_service, "_fetch_tenant_info", AsyncMock(side_effect=fake)):
        await jira_service.resolve_cloud_id("x.atlassian.net/")

    assert captured["site_url"] == "https://x.atlassian.net"
```

- [ ] **Step 2: Run tests to verify failures**

```bash
cd backend && uv run pytest tests/test_jira_helpers.py -k resolve_cloud_id -v
```

Expected: errors (`_fetch_tenant_info` / `resolve_cloud_id` not defined).

- [ ] **Step 3: Implement `_fetch_tenant_info` + `resolve_cloud_id`**

Append to `backend/app/services/jira_service.py` (after the pure helpers; `aiohttp` is already imported):

```python
async def _fetch_tenant_info(site_url: str) -> dict:
    """GET {site_url}/_edge/tenant_info. Raises on non-200 or transport error."""
    url = f"{site_url}/_edge/tenant_info"
    async with aiohttp.ClientSession() as session:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            if resp.status != 200:
                raise RuntimeError(f"HTTP {resp.status}")
            return await resp.json()


async def resolve_cloud_id(site_url: str) -> str:
    """Look up cloudId for the given Atlassian site. Raises ValueError on failure."""
    normalized = normalize_site_url(site_url)
    try:
        data = await _fetch_tenant_info(normalized)
    except Exception as e:
        raise ValueError(f"tenant_info 호출 실패: {e}")
    cloud_id = data.get("cloudId")
    if not cloud_id:
        raise ValueError("cloudId missing in tenant_info response")
    return cloud_id
```

- [ ] **Step 4: Run the new tests**

```bash
cd backend && uv run pytest tests/test_jira_helpers.py -k resolve_cloud_id -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/jira_service.py backend/tests/test_jira_helpers.py
git commit -m "feat(backend): add resolve_cloud_id via Atlassian tenant_info endpoint"
```

---

## Task 6: Refactor `create_jira_issue` — drop URL construction

**Files:**
- Modify: `backend/app/services/jira_service.py`

- [ ] **Step 1: Locate the function**

Open `backend/app/services/jira_service.py` and find `create_jira_issue` (around lines 82-89). Current return value includes both `key` and `url`.

- [ ] **Step 2: Drop the URL line; return only the key**

Change the return block from:

```python
issue_key = body["key"]
issue_url = f"{config.base_url.rstrip('/')}/browse/{issue_key}"
return {"key": issue_key, "url": issue_url}
```

to:

```python
return {"key": body["key"]}
```

No other change in the function.

- [ ] **Step 3: Confirm the module still imports**

```bash
cd backend && uv run python -c "from app.services import jira_service; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/jira_service.py
git commit -m "refactor(backend): drop issue url from create_jira_issue return"
```

---

## Task 7: `sr_service.submit_sr` — stop persisting `jira_issue_url`

**Files:**
- Modify: `backend/app/services/sr_service.py`

- [ ] **Step 1: Locate the assignment**

Open `backend/app/services/sr_service.py` and find the block around line 96-99:

```python
issue = await jira_service.create_jira_issue(config, draft)
draft.jira_issue_key = issue["key"]
draft.jira_issue_url = issue["url"]
```

- [ ] **Step 2: Remove the `jira_issue_url` assignment**

Edit to:

```python
issue = await jira_service.create_jira_issue(config, draft)
draft.jira_issue_key = issue["key"]
# jira_issue_url is no longer persisted; SR responses derive it from config.site_url
```

Also scan the rest of the function for any other `draft.jira_issue_url = ...` assignments in fallback / local paths. If found, delete those assignments too (leave `jira_issue_key` writes intact). Existing `draft.jira_issue_url = None` (already-None) assignments can stay or be removed; both are equivalent now.

Additionally, scan `submit_sr` (and any sibling function) for usages of `issue["url"]` or a return dict that exposes a `jira_url` / `url` key sourced from `create_jira_issue` — after Task 6, `create_jira_issue` returns only `{"key": ...}`, so any remaining `issue["url"]` access will raise `KeyError`. Remove such usages; if the return dict still needs to communicate the issue URL to the caller, compute it via `jira_service.build_jira_issue_url(draft.jira_issue_key, config)` instead.

- [ ] **Step 3: Confirm import**

```bash
cd backend && uv run python -c "from app.services import sr_service; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/sr_service.py
git commit -m "refactor(backend): stop writing jira_issue_url on SR draft"
```

---

## Task 8: `POST /api/jira/config` upsert — derive base_url from site_url

**Files:**
- Modify: `backend/app/routers/jira.py`
- Modify: `backend/app/services/jira_service.py` (only if `save_config`/`get_active_config` need a new field; verify first)
- Create: `backend/tests/test_jira_config_router.py`

- [ ] **Step 1: Read the current upsert handler**

```bash
sed -n '1,80p' backend/app/routers/jira.py
```

Locate the existing `PUT /config` (or `POST /config`) handler that calls `jira_service.save_config(...)` or similar. Note the exact handler name and the function it calls in the service.

- [ ] **Step 2: Write a failing integration test for derive-on-upsert**

Create `backend/tests/test_jira_config_router.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch

from app.services import jira_service


@pytest.mark.asyncio(loop_scope="session")
async def test_upsert_config_derives_base_url(client):
    payload = {
        "site_url": "https://manual-automation.atlassian.net",
        "user_email": "svc@example.com",
        "api_token": "tok",
        "project_key": "SCRUM",
        "is_active": True,
        "trigger_status_names": None,
    }
    with patch.object(
        jira_service, "resolve_cloud_id", AsyncMock(return_value="7b4ffc68-CID")
    ):
        resp = await client.put("/api/jira/config", json=payload)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["site_url"] == "https://manual-automation.atlassian.net"
    assert body["base_url"] == "https://api.atlassian.com/ex/jira/7b4ffc68-CID"


@pytest.mark.asyncio(loop_scope="session")
async def test_upsert_config_rejects_invalid_site(client):
    payload = {
        "site_url": "https://broken.atlassian.net",
        "user_email": "svc@example.com",
        "api_token": "tok",
        "project_key": "SCRUM",
        "is_active": True,
        "trigger_status_names": None,
    }
    with patch.object(
        jira_service,
        "resolve_cloud_id",
        AsyncMock(side_effect=ValueError("tenant_info 호출 실패: HTTP 404")),
    ):
        resp = await client.put("/api/jira/config", json=payload)

    assert resp.status_code == 400
    assert "cloudId" in resp.json()["detail"] or "tenant_info" in resp.json()["detail"]
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd backend && uv run pytest tests/test_jira_config_router.py -v
```

Expected: failures (router still expects `base_url`, returns 422 / 500).

- [ ] **Step 4: Update the upsert handler + `get_config` in the router**

In `backend/app/routers/jira.py`, the existing handler is `save_config` (PUT `/config`, lines 40-53) and it manually constructs the response with `JiraConfigResponse(id=..., base_url=..., ..., created_at=..., updated_at=...)`. Replace it with:

```python
from fastapi import HTTPException
from app.services.jira_service import (
    derive_base_url,
    normalize_site_url,
    resolve_cloud_id,
)

# ...

@router.put("/config", response_model=JiraConfigResponse)
async def save_config(data: JiraConfigUpsert, db: AsyncSession = Depends(get_db)):
    site_url = normalize_site_url(data.site_url)
    try:
        cloud_id = await resolve_cloud_id(site_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    derived_base_url = derive_base_url(cloud_id)

    # Service-layer upsert already skips empty api_token (jira_service.upsert_config:54-55),
    # so we just hand over the full dict.
    payload = data.model_dump()
    payload["site_url"] = site_url
    payload["base_url"] = derived_base_url
    config = await jira_service.upsert_config(db, payload)

    return JiraConfigResponse(
        id=config.id,
        site_url=config.site_url,
        base_url=config.base_url,
        user_email=config.user_email,
        api_token_masked=jira_service.mask_token(config.api_token),
        project_key=config.project_key,
        is_active=config.is_active,
        trigger_status_names=config.trigger_status_names,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )
```

Then also update the sibling `get_config` handler (lines 22-37) so its manual response build includes `site_url`:

```python
@router.get("/config", response_model=JiraConfigResponse | None)
async def get_config(db: AsyncSession = Depends(get_db)):
    config = await jira_service.get_active_config(db)
    if not config:
        return None
    return JiraConfigResponse(
        id=config.id,
        site_url=config.site_url,
        base_url=config.base_url,
        user_email=config.user_email,
        api_token_masked=jira_service.mask_token(config.api_token),
        project_key=config.project_key,
        is_active=config.is_active,
        trigger_status_names=config.trigger_status_names,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )
```

`jira_service.upsert_config(db, data: dict)` already iterates the dict and `setattr`s each key onto the ORM row, so once `site_url` is in the dict, it lands in the DB column added by Task 1 — no service-layer change required for this step.

- [ ] **Step 5: Re-run router tests**

```bash
cd backend && uv run pytest tests/test_jira_config_router.py -v
```

Expected: 2 passed. If still failing on api_token (because `data.api_token` is now `Optional` and empty), confirm the service tolerates `None`/empty.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/jira.py backend/app/services/jira_service.py backend/tests/test_jira_config_router.py
git commit -m "feat(backend): derive base_url from site_url on jira config upsert"
```

---

## Task 9: `POST /api/jira/config/test` — derive + include cloudId in success message

**Files:**
- Modify: `backend/app/routers/jira.py`
- Modify: `backend/app/services/jira_service.py` (extend `test_connection` to receive/return cloudId)
- Modify: `backend/tests/test_jira_config_router.py`

- [ ] **Step 1: Append failing test**

Append to `backend/tests/test_jira_config_router.py`:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_test_endpoint_returns_cloud_id(client):
    payload = {
        "site_url": "https://manual-automation.atlassian.net",
        "user_email": "svc@example.com",
        "api_token": "tok",
        "project_key": "SCRUM",
        "is_active": True,
        "trigger_status_names": None,
    }
    with patch.object(
        jira_service, "resolve_cloud_id", AsyncMock(return_value="7b4ffc68-CID")
    ), patch.object(
        jira_service,
        "test_connection",
        AsyncMock(return_value={"success": True, "message": "연결됨: svc"}),
    ):
        resp = await client.post("/api/jira/config/test", json=payload)

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert "7b4ffc68-CID" in body["message"]
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd backend && uv run pytest tests/test_jira_config_router.py::test_test_endpoint_returns_cloud_id -v
```

Expected: 500/422 or "cloudId not in message".

- [ ] **Step 3: Update the `/config/test` handler**

In `backend/app/routers/jira.py`, replace the test handler body (current behavior: builds a temp config from data, calls `test_connection`):

```python
@router.post("/config/test", response_model=JiraConnectionTestResult)
async def test_config(data: JiraConfigUpsert, db: AsyncSession = Depends(get_db)):
    site_url = normalize_site_url(data.site_url)
    try:
        cloud_id = await resolve_cloud_id(site_url)
    except ValueError as e:
        return JiraConnectionTestResult(success=False, message=str(e))

    api_token = data.api_token
    if not api_token:
        existing = await jira_service.get_active_config(db)
        if existing:
            api_token = existing.api_token

    temp = JiraConfig(
        site_url=site_url,
        base_url=derive_base_url(cloud_id),
        user_email=data.user_email,
        api_token=api_token,
        project_key=data.project_key,
    )
    result = await jira_service.test_connection(temp)
    if result.get("success"):
        result["message"] = f"{result['message']} (cloudId: {cloud_id})"
    return JiraConnectionTestResult(**result)
```

- [ ] **Step 4: Run all router tests**

```bash
cd backend && uv run pytest tests/test_jira_config_router.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/jira.py backend/tests/test_jira_config_router.py
git commit -m "feat(backend): include cloudId in jira config test success message"
```

---

## Task 10: Add SR response builders `build_sr_response` / `build_sr_responses`

**Files:**
- Modify: `backend/app/services/sr_service.py`

- [ ] **Step 1: Add the builders to `sr_service.py`**

Append to `backend/app/services/sr_service.py` (after existing imports + functions; `jira_service` is already imported per Task 7's neighborhood):

```python
from app.schemas.sr import SRDraftResponse


async def build_sr_response(db, draft) -> SRDraftResponse:
    """Convert an SRDraft ORM instance to a response with a freshly computed jira_issue_url."""
    config = await jira_service.get_active_config(db)
    response = SRDraftResponse.model_validate(draft)
    response.jira_issue_url = jira_service.build_jira_issue_url(draft.jira_issue_key, config)
    return response


async def build_sr_responses(db, drafts) -> list[SRDraftResponse]:
    """Same as build_sr_response but fetches config once for a batch."""
    config = await jira_service.get_active_config(db)
    out: list[SRDraftResponse] = []
    for draft in drafts:
        response = SRDraftResponse.model_validate(draft)
        response.jira_issue_url = jira_service.build_jira_issue_url(draft.jira_issue_key, config)
        out.append(response)
    return out
```

If the top of `sr_service.py` does `from app.schemas.sr import ...`, fold `SRDraftResponse` into the existing import group instead of re-importing.

- [ ] **Step 2: Confirm import**

```bash
cd backend && uv run python -c "from app.services.sr_service import build_sr_response, build_sr_responses; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/sr_service.py
git commit -m "feat(backend): add SR response builders that inject dynamic jira_issue_url"
```

---

## Task 11: Wire SR router endpoints through the new builders + integration test

**Files:**
- Modify: `backend/app/routers/sr.py`
- Create: `backend/tests/test_sr_jira_url.py`

- [ ] **Step 1: Write a failing integration test**

Create `backend/tests/test_sr_jira_url.py`:

```python
import uuid
import pytest

from app.models.jira import JiraConfig
from app.models.sr import SRDraft


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_list_response_uses_site_url(client, db_session):
    # Seed an active config with a site_url
    cfg = JiraConfig(
        id=uuid.uuid4(),
        site_url="https://manual-automation.atlassian.net",
        base_url="https://api.atlassian.com/ex/jira/cid-xyz",
        user_email="svc@example.com",
        api_token="tok",
        project_key="SCRUM",
        is_active=True,
    )
    db_session.add(cfg)

    # Seed an SR with a stale wrong URL on the DB column
    resp = await client.post(
        "/api/users",
        json={"name": "U", "email": f"u_{uuid.uuid4().hex[:8]}@e.com", "role": "editor"},
    )
    user_id = uuid.UUID(resp.json()["id"])

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title="t",
        description="d",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        jira_issue_key="SCRUM-178",
        jira_issue_url="https://api.atlassian.com/ex/jira/cid-xyz/browse/SCRUM-178",
    )
    db_session.add(sr)
    await db_session.commit()

    list_resp = await client.get(f"/api/sr/drafts?user_id={user_id}")
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["jira_issue_key"] == "SCRUM-178"
    assert items[0]["jira_issue_url"] == "https://manual-automation.atlassian.net/browse/SCRUM-178"


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_list_response_local_key_yields_none_url(client, db_session):
    cfg = JiraConfig(
        id=uuid.uuid4(),
        site_url="https://manual-automation.atlassian.net",
        base_url="https://api.atlassian.com/ex/jira/cid-xyz",
        user_email="svc@example.com",
        api_token="tok",
        project_key="SCRUM",
        is_active=True,
    )
    db_session.add(cfg)

    resp = await client.post(
        "/api/users",
        json={"name": "U", "email": f"u_{uuid.uuid4().hex[:8]}@e.com", "role": "editor"},
    )
    user_id = uuid.UUID(resp.json()["id"])

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title="t",
        description="d",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        jira_issue_key="LOCAL-DEADBEEF",
        jira_issue_url=None,
    )
    db_session.add(sr)
    await db_session.commit()

    list_resp = await client.get(f"/api/sr/drafts?user_id={user_id}")
    items = list_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["jira_issue_url"] is None
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd backend && uv run pytest tests/test_sr_jira_url.py -v
```

Expected: first test fails (DB URL leaks through unchanged).

- [ ] **Step 3: Update SR router endpoints to use the builders**

In `backend/app/routers/sr.py`, change each endpoint that returns an SR draft or list:

```python
# create_sr_draft
@router.post("/drafts", response_model=SRDraftResponse, status_code=201)
async def create_sr_draft(data: SRDraftCreate, db: AsyncSession = Depends(get_db)):
    draft = await sr_service.create_sr_draft(db, data)
    return await sr_service.build_sr_response(db, draft)


# generate_sr_draft
@router.post("/generate", response_model=SRDraftResponse, status_code=201)
async def generate_sr_draft(data: SRGenerateRequest, db: AsyncSession = Depends(get_db)):
    draft = await sr_service.generate_sr_draft(
        db, data.user_id, data.document_id, data.issue_description
    )
    return await sr_service.build_sr_response(db, draft)


# update_sr_draft
@router.patch("/drafts/{sr_id}", response_model=SRDraftResponse)
async def update_sr_draft(
    sr_id: uuid.UUID,
    data: SRDraftUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        draft = await sr_service.update_sr_draft(db, sr_id, data.model_dump(exclude_none=True))
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    return await sr_service.build_sr_response(db, draft)


# list_sr_drafts
@router.get("/drafts", response_model=SRDraftListResponse)
async def list_sr_drafts(
    user_id: uuid.UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    try:
        items, total = await sr_service.list_sr_drafts(db, user_id, status, skip, limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"items": await sr_service.build_sr_responses(db, items), "total": total}
```

Do NOT modify `submit_sr` endpoint or `complete_sr_local` endpoint — those return raw dicts (no `response_model=SRDraftResponse`), so they're not in scope for jira_issue_url leakage.

- [ ] **Step 4: Run all SR + jira tests**

```bash
cd backend && uv run pytest tests/test_sr_jira_url.py tests/test_jira_config_router.py tests/test_jira_helpers.py -v
```

Expected: all pass.

- [ ] **Step 5: Run the broader test suite to catch regressions**

```bash
cd backend && uv run pytest -x -q
```

Expected: green. Any pre-existing SR tests that assumed the DB-stored URL value should now read the freshly computed one; if any fail, the assertion needs to use the new site_url-based URL — fix the assertion (not the impl).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/sr.py backend/tests/test_sr_jira_url.py
git commit -m "feat(backend): rebuild SR jira_issue_url from site_url at response time"
```

---

## Task 12: Frontend `api.ts` — switch types and payloads to `site_url`

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Update the `JiraConfig` interface**

In `frontend/src/lib/api.ts`, find the `JiraConfig` interface (around line 330) and replace it:

```typescript
export interface JiraConfig {
  id: string
  site_url: string | null
  base_url: string
  user_email: string
  api_token_masked: string
  project_key: string
  is_active: boolean
  trigger_status_names: string[] | null
  updated_at: string
}
```

- [ ] **Step 2: Update `saveJiraConfig` and `testJiraConfig` payload signatures**

In the same file (around lines 242-248), replace those wrappers:

```typescript
getJiraConfig: () => request<JiraConfig | null>('/jira/config'),

saveJiraConfig: (data: {
  site_url: string
  user_email: string
  api_token: string
  project_key: string
  is_active: boolean
  trigger_status_names: string[] | null
}) => request<JiraConfig>('/jira/config', { method: 'PUT', body: JSON.stringify(data) }),

testJiraConfig: (data: {
  site_url: string
  user_email: string
  api_token: string
  project_key: string
  is_active: boolean
  trigger_status_names: string[] | null
}) => request<{ success: boolean; message: string }>('/jira/config/test', {
  method: 'POST',
  body: JSON.stringify(data),
}),
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && pnpm typecheck
```

Expected: errors only in `WebhookLogs.tsx` (which still references `base_url` on inputs). That's exactly the next task.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): switch Jira config types to site_url"
```

---

## Task 13: Frontend `WebhookLogs.tsx` — site_url input + derived base_url display

**Files:**
- Modify: `frontend/src/pages/WebhookLogs.tsx`

- [ ] **Step 1: Read the current form section**

```bash
sed -n '1,220p' frontend/src/pages/WebhookLogs.tsx
```

Locate:
- `useState` initializing `form` with `base_url` (around lines 19-23)
- The `base_url` `<input>` element (lines 154-200 region)
- `handleSave` and `handleTest` referencing `form.base_url`

- [ ] **Step 2: Replace `base_url` with `site_url` in state, inputs, and handler payloads**

Apply the edits below. Adjust label/styling to match the surrounding form pattern (keep CSS classes identical to the existing `base_url` input).

State (replace `base_url:` with `site_url:`):

```tsx
const [form, setForm] = useState({
  site_url: '',
  user_email: '',
  api_token: '',
  project_key: '',
  trigger_status_names: '',
  is_active: true,
})
```

`useEffect` hydration from server config (replace any `base_url: config.base_url` with `site_url: config.site_url ?? ''`).

Input element (replace the `base_url` input block):

```tsx
<div>
  <label className="block text-xs text-[#757684] mb-1">Atlassian Site URL</label>
  <input
    type="text"
    className="w-full ..." // keep existing classes used by the old base_url input
    placeholder="https://your-site.atlassian.net"
    value={form.site_url}
    onChange={(e) => setForm({ ...form, site_url: e.target.value })}
  />
  <p className="text-xs text-[#757684] mt-1">
    예: https://manual-automation.atlassian.net — service account 사용 시 cloudId 자동 추출
  </p>
</div>
```

Read-only derived `base_url` (place beneath the site_url input, only when `config?.base_url` exists):

```tsx
{config?.base_url && (
  <div>
    <label className="block text-xs text-[#757684] mb-1">내부 API URL (자동)</label>
    <input
      type="text"
      className="w-full ... bg-gray-50" // greyed-out
      value={config.base_url}
      readOnly
    />
  </div>
)}
```

`handleSave`/`handleTest` payloads — replace `base_url: form.base_url` with `site_url: form.site_url`.

- [ ] **Step 3: Type-check**

```bash
cd frontend && pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Lint**

```bash
cd frontend && pnpm lint
```

Expected: no new errors (warnings unrelated to this file are OK).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WebhookLogs.tsx
git commit -m "feat(frontend): replace Jira base_url input with site_url + read-only derived base_url"
```

---

## Task 14: Manual verification (HARNESS.md VERIFY)

**Files:** none (manual).

- [ ] **Step 1: Start backend + frontend**

```bash
cd backend && uv run fastapi dev &
cd frontend && pnpm dev
```

(Or `docker compose up --build` per CLAUDE.md.) Wait for both to be healthy.

- [ ] **Step 2: In the browser, open the Jira config (WebhookLogs) page**

Verify:
- Old `base_url` field is gone.
- New `Atlassian Site URL` field is present with the helper text.

- [ ] **Step 3: Enter site URL and save**

Input: `https://manual-automation.atlassian.net`. Keep other fields as they were (project_key=SCRUM, service-account email + token).

Click Save. Verify:
- Save succeeds.
- The read-only `내부 API URL (자동)` field now shows `https://api.atlassian.com/ex/jira/7b4ffc68-2983-46cb-b50f-5f2ef43a6a57` (or whatever cloudId the tenant_info returns).

- [ ] **Step 4: Click the test/connection button**

Verify success message format: `연결됨: <displayName> (cloudId: 7b4ffc68-...)`.

- [ ] **Step 5: Navigate to an SR with an existing Jira issue (e.g., SCRUM-178)**

Open the SR list page. Verify:
- The issue key `SCRUM-178` renders as a link.
- Hovering the link shows `https://manual-automation.atlassian.net/browse/SCRUM-178` in the status bar.
- Clicking it opens Jira's normal login (no `permissionViolation` redirect).

- [ ] **Step 6: Negative path — invalid site URL**

In the config page, change site URL to `https://nonexistent-tenant-xyz123.atlassian.net` and click Save. Verify HTTP 400 surfaces in the UI with the `tenant_info 호출 실패` style message. Restore the real site URL afterward.

- [ ] **Step 7: Commit any test-suite or doc tweaks made along the way**

If any pre-existing tests had to be adjusted in Task 11 step 5, they should already be committed. Final sanity check:

```bash
git status
cd backend && uv run pytest -x -q
cd frontend && pnpm typecheck && pnpm lint
```

Expected: clean working tree, all tests pass, no type errors.

---

## Self-Review notes (resolved before publishing)

- Spec section 1 (model + migration): Task 1 covers column + backfill SQL.
- Spec section 2 (resolve_cloud_id, derive_base_url, normalize_site_url): Tasks 3 and 5.
- Spec section 2 oracle (cloudId in success message): Task 9.
- Spec section 3 (dynamic issue URL + build_jira_issue_url helper): Tasks 4, 10, 11.
- Spec section 3 (drop URL from create_jira_issue, drop assignment in submit_sr): Tasks 6 and 7.
- Spec section 4 (frontend UX with site_url input + read-only derived base_url): Tasks 12 and 13.
- Spec section 5 (test plan): unit tests in Tasks 3-5, integration tests in Tasks 8-9 + 11, manual verification in Task 14. Migration test was intentionally swapped for an integration insert/select in Task 11 (existing test infra builds schema via `Base.metadata.create_all`, not Alembic) — acceptable trade-off documented here.
- Edge case (site_url NULL → "시뮬레이션" text) is implicit in `build_jira_issue_url` returning `None`; no UI branch added per spec.
