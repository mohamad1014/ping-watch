import os

import pytest

os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://pingwatch:pingwatch@localhost:5432/pingwatch"
)

from app.db import SessionLocal, init_db  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.store import reset_store  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_database():
    init_db()
    if engine.url.drivername.startswith("sqlite"):
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        reset_store(db)
    yield
    with SessionLocal() as db:
        reset_store(db)
