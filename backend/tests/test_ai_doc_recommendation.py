import json
import uuid

import pytest
from httpx import AsyncClient


async def _make_pending_sr(client: AsyncClient, test_user: dict) -> str:
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "AI Rec Test",
        "description": "Test SR for AI recommendation",
        "priority": "medium",
    })
    sr_id = create_resp.json()["id"]
    await client.post(f"/api/sr/drafts/{sr_id}/submit")
    await client.post(f"/api/sr/drafts/{sr_id}/complete-local")
    return sr_id


class _FakeLLM:
    def __init__(self, payload: dict):
        self.payload = payload
        self.calls = 0

    async def generate(self, system_prompt: str, user_message: str, context: str = "") -> str:
        self.calls += 1
        return json.dumps(self.payload)


@pytest.mark.asyncio(loop_scope="session")
async def test_get_recommendation_returns_null_when_none_cached(
    client: AsyncClient, test_user: dict
):
    sr_id = await _make_pending_sr(client, test_user)
    resp = await client.get(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio(loop_scope="session")
async def test_post_recommendation_calls_llm_and_persists(
    client: AsyncClient, test_user: dict, monkeypatch
):
    sr_id = await _make_pending_sr(client, test_user)
    fake = _FakeLLM({
        "recommendation": "new",
        "reason": "기존 문서 중 적합한 것이 없습니다.",
        "suggested_document_id": None,
    })
    monkeypatch.setattr(
        "app.services.ai_recommendation_service.get_llm_provider", lambda: fake
    )

    resp = await client.post(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    assert resp.status_code == 200
    body = resp.json()
    assert body["recommendation"] == "new"
    assert body["reason"] == "기존 문서 중 적합한 것이 없습니다."
    assert body["suggested_document_id"] is None
    assert fake.calls == 1

    # 다시 GET 하면 캐시된 값
    get_resp = await client.get(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    assert get_resp.status_code == 200
    assert get_resp.json()["recommendation"] == "new"


@pytest.mark.asyncio(loop_scope="session")
async def test_post_recommendation_returns_cached_without_force(
    client: AsyncClient, test_user: dict, monkeypatch
):
    sr_id = await _make_pending_sr(client, test_user)
    fake = _FakeLLM({
        "recommendation": "new",
        "reason": "초기 추천",
        "suggested_document_id": None,
    })
    monkeypatch.setattr(
        "app.services.ai_recommendation_service.get_llm_provider", lambda: fake
    )

    await client.post(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    assert fake.calls == 1

    # 두 번째 호출 — force=false (기본). LLM 호출 안 함.
    resp = await client.post(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    assert resp.status_code == 200
    assert fake.calls == 1  # 증가 없음
    assert resp.json()["reason"] == "초기 추천"


@pytest.mark.asyncio(loop_scope="session")
async def test_post_recommendation_force_recomputes(
    client: AsyncClient, test_user: dict, monkeypatch
):
    sr_id = await _make_pending_sr(client, test_user)
    fake = _FakeLLM({
        "recommendation": "new",
        "reason": "첫번째",
        "suggested_document_id": None,
    })
    monkeypatch.setattr(
        "app.services.ai_recommendation_service.get_llm_provider", lambda: fake
    )

    await client.post(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    fake.payload = {
        "recommendation": "none",
        "reason": "두번째",
        "suggested_document_id": None,
    }
    resp = await client.post(
        f"/api/sr/drafts/{sr_id}/ai-doc-recommendation?force=true"
    )
    assert resp.status_code == 200
    assert resp.json()["recommendation"] == "none"
    assert fake.calls == 2


@pytest.mark.asyncio(loop_scope="session")
async def test_post_recommendation_invalid_llm_json_returns_502(
    client: AsyncClient, test_user: dict, monkeypatch
):
    sr_id = await _make_pending_sr(client, test_user)

    class BadLLM:
        async def generate(self, *args, **kwargs):
            return "this is not json at all"

    monkeypatch.setattr(
        "app.services.ai_recommendation_service.get_llm_provider", lambda: BadLLM()
    )

    resp = await client.post(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    assert resp.status_code == 502
    assert "AI 추천 생성 실패" in resp.json()["detail"]


@pytest.mark.asyncio(loop_scope="session")
async def test_post_recommendation_invalid_recommendation_value_returns_502(
    client: AsyncClient, test_user: dict, monkeypatch
):
    sr_id = await _make_pending_sr(client, test_user)
    fake = _FakeLLM({
        "recommendation": "maybe",
        "reason": "...",
        "suggested_document_id": None,
    })
    monkeypatch.setattr(
        "app.services.ai_recommendation_service.get_llm_provider", lambda: fake
    )

    resp = await client.post(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    assert resp.status_code == 502


@pytest.mark.asyncio(loop_scope="session")
async def test_post_recommendation_nonexistent_suggested_doc_id_strips_to_null(
    client: AsyncClient, test_user: dict, monkeypatch
):
    sr_id = await _make_pending_sr(client, test_user)
    bogus_id = str(uuid.uuid4())
    fake = _FakeLLM({
        "recommendation": "existing",
        "reason": "어느 문서로 추천",
        "suggested_document_id": bogus_id,
    })
    monkeypatch.setattr(
        "app.services.ai_recommendation_service.get_llm_provider", lambda: fake
    )

    resp = await client.post(f"/api/sr/drafts/{sr_id}/ai-doc-recommendation")
    assert resp.status_code == 200
    body = resp.json()
    assert body["recommendation"] == "existing"
    assert body["suggested_document_id"] is None


@pytest.mark.asyncio(loop_scope="session")
async def test_get_recommendation_returns_404_for_nonexistent_sr(client: AsyncClient):
    bogus = str(uuid.uuid4())
    resp = await client.get(f"/api/sr/drafts/{bogus}/ai-doc-recommendation")
    assert resp.status_code == 404
