import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_cors_allows_local_frontend_origin():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/sessions/start",
            headers={"origin": "http://localhost:5173"},
            json={"device_id": "dev_1"},
        )

    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
