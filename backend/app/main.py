import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.logging import setup_logging
from app.routes.devices import router as devices_router
from app.routes.events import router as events_router
from app.routes.notifications import router as notifications_router
from app.routes.sessions import router as sessions_router

logger = setup_logging()

app = FastAPI(title="ping-watch-api")
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
app.include_router(sessions_router)
app.include_router(devices_router)
app.include_router(events_router)
app.include_router(notifications_router)


@app.on_event("startup")
async def startup():
    init_db()


@app.middleware("http")
async def request_logger(request: Request, call_next):
    start_time = time.perf_counter()
    request_id = request.headers.get("x-request-id") or str(uuid4())
    device_id = request.headers.get("x-device-id")
    session_id = request.headers.get("x-session-id")
    event_id = request.headers.get("x-event-id")

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
