import os

import pytest

os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://pingwatch:pingwatch@localhost:5432/pingwatch"
)

from app.db import SessionLocal, init_db  # noqa: E402
from app.store import reset_store  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_database():
    init_db()
    with SessionLocal() as db:
        reset_store(db)
        yield
        reset_store(db)
