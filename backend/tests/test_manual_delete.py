import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_manual_job(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/manuals/jobs", json={
        "user_id": test_user["id"],
        "target_url": "https://example.com",
    })
    assert create_resp.status_code == 201
    job_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/manuals/jobs/{job_id}")
    assert del_resp.status_code == 204

    get_resp = await client.get(f"/api/manuals/jobs/{job_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_unknown_manual_job(client: AsyncClient):
    fake_id = uuid.uuid4()
    resp = await client.delete(f"/api/manuals/jobs/{fake_id}")
    assert resp.status_code == 404
