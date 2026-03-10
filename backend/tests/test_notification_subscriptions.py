import sqlalchemy as sa

from app.db import SessionLocal, engine
from app.store import link_device_telegram_chat, register_device


def test_init_db_creates_device_notification_subscriptions_table():
    inspector = sa.inspect(engine)

    assert "device_notification_subscriptions" in inspector.get_table_names()

    columns = {
        column["name"]
        for column in inspector.get_columns("device_notification_subscriptions")
    }
    assert columns >= {"subscription_id", "device_id", "endpoint_id", "created_at"}

    unique_constraints = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            "device_notification_subscriptions"
        )
    }
    assert "uq_device_notification_subscriptions_device_endpoint" in unique_constraints


def test_link_device_telegram_chat_adds_new_subscription_without_removing_existing_one():
    inspector = sa.inspect(engine)
    assert "device_notification_subscriptions" in inspector.get_table_names()

    subscriptions = sa.Table(
        "device_notification_subscriptions",
        sa.MetaData(),
        autoload_with=engine,
    )
    endpoints = sa.Table(
        "notification_endpoints",
        sa.MetaData(),
        autoload_with=engine,
    )

    with SessionLocal() as db:
        register_device(db, device_id="dev-1")

        link_device_telegram_chat(
            db,
            device_id="dev-1",
            chat_id="111",
            username="alice",
        )
        link_device_telegram_chat(
            db,
            device_id="dev-1",
            chat_id="222",
            username="bob",
        )

        rows = db.execute(
            sa.select(endpoints.c.chat_id)
            .select_from(
                subscriptions.join(
                    endpoints,
                    subscriptions.c.endpoint_id == endpoints.c.endpoint_id,
                )
            )
            .where(subscriptions.c.device_id == "dev-1")
            .order_by(endpoints.c.chat_id)
        ).all()

    assert [row.chat_id for row in rows] == ["111", "222"]
