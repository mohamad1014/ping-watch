import time
from uuid import uuid4

from fastapi import FastAPI, Request

from app.logging import setup_logging

logger = setup_logging()

app = FastAPI(title="ping-watch-api")


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
