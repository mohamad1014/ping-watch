import os

import pytest

os.environ.setdefault(
    "DATABASE_URL", "sqlite+pysqlite:///:memory:"
)

from app import models  # noqa: F401,E402
from app.db import Base, SessionLocal, engine, ensure_schema_compatible  # noqa: E402
from app.main import reset_rate_limiters  # noqa: E402
from app.store import reset_store  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_database():
    reset_rate_limiters()
    if engine.url.drivername.startswith("sqlite"):
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        ensure_schema_compatible(engine)
        yield
    else:
        from app.db import init_db  # noqa: E402

        init_db()
        with SessionLocal() as db:
            reset_store(db)
        yield
        with SessionLocal() as db:
            reset_store(db)
    reset_rate_limiters()
