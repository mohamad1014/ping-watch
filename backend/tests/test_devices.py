import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_register_device_creates_and_is_idempotent():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post("/devices/register", json={"label": "Kitchen"})
        assert first.status_code == 200
        payload = first.json()
        assert payload["device_id"]
        assert payload["label"] == "Kitchen"
        assert payload["created_at"]

        second = await client.post(
            "/devices/register",
            json={"device_id": payload["device_id"], "label": "Kitchen"},
        )

    assert second.status_code == 200
    payload2 = second.json()
    assert payload2["device_id"] == payload["device_id"]
    assert payload2["created_at"] == payload["created_at"]
