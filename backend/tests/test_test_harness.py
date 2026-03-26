from app.db import engine


def test_backend_test_harness_defaults_to_sqlite():
    assert engine.url.drivername.startswith("sqlite")
