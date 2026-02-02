import os
import signal
import socket
import subprocess
import sys
import time

import httpx


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_for_health(base_url: str, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            response = httpx.get(f"{base_url}/health", timeout=0.5)
            if response.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError("Server did not become ready")


def test_live_server_session_flow():
    port = _get_free_port()
    base_url = f"http://127.0.0.1:{port}"

    env = os.environ.copy()
    env["PYTHONPATH"] = os.path.dirname(__file__) + "/.."
    env["DATABASE_URL"] = "sqlite:///./test-live.db"
    db_path = os.path.join(os.path.dirname(__file__), "..", "test-live.db")
    if os.path.exists(db_path):
        os.remove(db_path)

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=os.path.dirname(__file__) + "/..",
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        _wait_for_health(base_url)

        start = httpx.post(
            f"{base_url}/sessions/start", json={"device_id": "dev_1"}
        )
        assert start.status_code == 200
        session_id = start.json()["session_id"]

        created = httpx.post(
            f"{base_url}/events",
            json={
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 4.2,
                "clip_uri": "local://clip-1",
                "clip_mime": "video/mp4",
                "clip_size_bytes": 321,
            },
        )
        assert created.status_code == 200

        listed = httpx.get(f"{base_url}/events?session_id={session_id}")
        assert listed.status_code == 200
        assert len(listed.json()) == 1

        stopped = httpx.post(
            f"{base_url}/sessions/stop", json={"session_id": session_id}
        )
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "stopped"
    finally:
        process.send_signal(signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        if os.path.exists(db_path):
            os.remove(db_path)
