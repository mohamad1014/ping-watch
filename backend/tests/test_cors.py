import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_cors_allows_local_frontend_origin():
    origin = "http://localhost:5173"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.options(
            "/sessions/start",
            headers={
                "origin": origin,
                "access-control-request-method": "POST",
            },
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert "POST" in response.headers.get("access-control-allow-methods", "")


@pytest.mark.anyio
async def test_cors_allows_private_lan_frontend_origin():
    origin = "http://192.168.1.29:5173"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.options(
            "/devices/register",
            headers={
                "origin": origin,
                "access-control-request-method": "POST",
            },
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert "POST" in response.headers.get("access-control-allow-methods", "")


@pytest.mark.anyio
async def test_cors_allows_ngrok_frontend_origin():
    origin = "https://genny-unfunny-uriel.ngrok-free.dev"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.options(
            "/notifications/telegram/readiness",
            headers={
                "origin": origin,
                "access-control-request-method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert "GET" in response.headers.get("access-control-allow-methods", "")
