import os

from sqlalchemy import inspect
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://pingwatch:pingwatch@localhost:5432/pingwatch"
)

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

Base = declarative_base()

_REQUIRED_EVENTS_COLUMNS = {
    "clip_container",
    "clip_blob_name",
    "clip_uploaded_at",
    "clip_etag",
}


def ensure_schema_compatible(engine: Engine) -> None:
    inspector = inspect(engine)
    if "events" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("events")}
    missing = sorted(_REQUIRED_EVENTS_COLUMNS - columns)
    if missing:
        raise RuntimeError(
            "Database schema is out of date; run `cd backend && .venv/bin/alembic upgrade head` "
            f"(missing columns on `events`: {', '.join(missing)})"
        )


def init_db() -> None:
    # Import models so they register with the metadata before create_all.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    ensure_schema_compatible(engine)


async def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
