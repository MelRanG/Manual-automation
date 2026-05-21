from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient

from app.services import manual_service


@pytest.mark.asyncio
async def test_upload_screenshot_puts_to_s3_and_removes_local(tmp_path, monkeypatch):
    calls: list[tuple[str, bytes]] = []

    monkeypatch.setattr(manual_service.settings, "uploads_s3_bucket", "test-bucket")
    monkeypatch.setattr(manual_service.settings, "uploads_s3_prefix", "uploads")
    monkeypatch.setattr(
        manual_service,
        "_put_s3_object",
        lambda key, content: calls.append((key, content)),
    )

    local = tmp_path / "abc_step1.jpg"
    local.write_bytes(b"jpgdata")

    await manual_service._upload_screenshot_to_s3_async(local)

    assert len(calls) == 1
    assert calls[0][0] == "uploads/screenshots/abc_step1.jpg"
    assert calls[0][1] == b"jpgdata"
    assert not local.exists()


@pytest.mark.asyncio
async def test_upload_screenshot_uses_empty_prefix(tmp_path, monkeypatch):
    calls: list[tuple[str, bytes]] = []

    monkeypatch.setattr(manual_service.settings, "uploads_s3_bucket", "b")
    monkeypatch.setattr(manual_service.settings, "uploads_s3_prefix", "")
    monkeypatch.setattr(
        manual_service,
        "_put_s3_object",
        lambda key, content: calls.append((key, content)),
    )

    local = tmp_path / "x.jpg"
    local.write_bytes(b"y")
    await manual_service._upload_screenshot_to_s3_async(local)

    assert calls[0][0] == "screenshots/x.jpg"


@pytest.mark.asyncio
async def test_upload_screenshot_requires_bucket(tmp_path, monkeypatch):
    monkeypatch.setattr(manual_service.settings, "uploads_s3_bucket", "")
    local = tmp_path / "x.jpg"
    local.write_bytes(b"x")
    with pytest.raises(RuntimeError, match="UPLOADS_S3_BUCKET"):
        await manual_service._upload_screenshot_to_s3_async(local)


@pytest.mark.asyncio
async def test_get_screenshot_streams_from_s3(client: AsyncClient, monkeypatch):
    from app import main as main_module

    monkeypatch.setattr(manual_service.settings, "uploads_s3_bucket", "test-bucket")
    monkeypatch.setattr(manual_service.settings, "uploads_s3_prefix", "uploads")

    body = MagicMock()
    body.read.return_value = b"binary-jpeg-bytes"

    fake_client = MagicMock()
    fake_client.get_object.return_value = {
        "Body": body,
        "ContentType": "image/jpeg",
    }

    monkeypatch.setattr(main_module, "_s3_client", lambda: fake_client)

    resp = await client.get("/uploads/screenshots/abc_step1.jpg")
    assert resp.status_code == 200
    assert resp.content == b"binary-jpeg-bytes"
    assert resp.headers["content-type"].startswith("image/jpeg")
    fake_client.get_object.assert_called_once_with(
        Bucket="test-bucket", Key="uploads/screenshots/abc_step1.jpg"
    )


@pytest.mark.asyncio
async def test_get_screenshot_404_when_missing(client: AsyncClient, monkeypatch):
    from app import main as main_module

    monkeypatch.setattr(manual_service.settings, "uploads_s3_bucket", "test-bucket")
    monkeypatch.setattr(manual_service.settings, "uploads_s3_prefix", "uploads")

    class FakeNoSuchKey(Exception):
        response = {"Error": {"Code": "NoSuchKey"}}

    fake_client = MagicMock()
    fake_client.get_object.side_effect = FakeNoSuchKey("nope")

    monkeypatch.setattr(main_module, "_s3_client", lambda: fake_client)

    resp = await client.get("/uploads/screenshots/missing.jpg")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_screenshot_rejects_dotdot(client: AsyncClient, monkeypatch):
    from app import main as main_module

    monkeypatch.setattr(manual_service.settings, "uploads_s3_bucket", "test-bucket")

    fake_client = MagicMock()
    monkeypatch.setattr(main_module, "_s3_client", lambda: fake_client)

    resp = await client.get("/uploads/screenshots/..")
    assert resp.status_code in (400, 404)
    fake_client.get_object.assert_not_called()
