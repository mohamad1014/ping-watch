import pytest

from app.db import SessionLocal, init_db
from app.store import reset_store


@pytest.fixture(autouse=True)
def _reset_database():
    init_db()
    with SessionLocal() as db:
        reset_store(db)
        yield
        reset_store(db)
