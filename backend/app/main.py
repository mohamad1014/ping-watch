from contextlib import asynccontextmanager
import math
import time
from collections import defaultdict, deque
from threading import Lock
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.auth import authenticate_request, should_authenticate_request
from app.db import init_db
from app.logging import setup_logging
from app.routes.auth import (
    DEV_LOGIN_ROUTE_PATH,
    dev_login_rate_limit_max_requests,
    dev_login_rate_limit_window_seconds,
    router as auth_router,
)
from app.routes.devices import router as devices_router
from app.routes.events import router as events_router
from app.routes.notifications import router as notifications_router
from app.routes.sessions import router as sessions_router

logger = setup_logging()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="ping-watch-api", lifespan=lifespan)
CORS_ALLOWED_ORIGIN_REGEX = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|0\.0\.0\.0|"
    r"10(?:\.\d{1,3}){3}|"
    r"192\.168(?:\.\d{1,3}){2}|"
    r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|"
    r"[a-z0-9-]+\.ngrok-free\.dev|"
    r"[a-z0-9-]+\.ngrok\.io"
    r")(:\d+)?$"
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ALLOWED_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["etag"],
)
app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(devices_router)
app.include_router(events_router)
app.include_router(notifications_router)


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def reset(self) -> None:
        with self._lock:
            self._events.clear()

    def check(self, key: str, *, limit: int, window_seconds: int) -> int | None:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._events[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= limit:
                oldest_event = bucket[0]
                retry_after = max(1, math.ceil(window_seconds - (now - oldest_event)))
                return retry_after

            bucket.append(now)
            return None


dev_login_rate_limiter = SlidingWindowRateLimiter()


def reset_rate_limiters() -> None:
    dev_login_rate_limiter.reset()


def _normalized_path(path: str) -> str:
    if path == "/":
        return path
    return path.rstrip("/")


def _request_client_identifier(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
        if client_ip:
            return client_ip

    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _rate_limit_response(request: Request) -> JSONResponse | None:
    if request.method.upper() != "POST":
        return None
    if _normalized_path(request.url.path) != DEV_LOGIN_ROUTE_PATH:
        return None

    retry_after = dev_login_rate_limiter.check(
        _request_client_identifier(request),
        limit=dev_login_rate_limit_max_requests(),
        window_seconds=dev_login_rate_limit_window_seconds(),
    )
    if retry_after is None:
        return None

    return JSONResponse(
        status_code=429,
        content={"detail": "rate limit exceeded"},
        headers={"Retry-After": str(retry_after)},
    )

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    try:
        if should_authenticate_request(request):
            user_id, auth_session_id = authenticate_request(request)
            request.state.auth_user_id = user_id
            request.state.auth_session_id = auth_session_id
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    return await call_next(request)


@app.middleware("http")
async def request_logger(request: Request, call_next):
    start_time = time.perf_counter()
    request_id = request.headers.get("x-request-id") or str(uuid4())
    device_id = request.headers.get("x-device-id")
    session_id = request.headers.get("x-session-id")
    event_id = request.headers.get("x-event-id")

    response = _rate_limit_response(request)
    if response is None:
        response = await call_next(request)

    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
    response.headers["x-request-id"] = request_id

    logger.info(
        "request",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "device_id": device_id,
            "session_id": session_id,
            "event_id": event_id,
        },
    )

    return response


@app.get("/health")
async def health():
    return {"status": "ok"}
