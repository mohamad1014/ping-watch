"""replace device telegram endpoint mapping with subscription join table

Revision ID: 0012_device_notify_subs
Revises: 0011_notification_endpoints
Create Date: 2026-03-10

"""

from datetime import datetime, timezone
from uuid import uuid4

import sqlalchemy as sa
from alembic import op


revision = "0012_device_notify_subs"
down_revision = "0011_notification_endpoints"
branch_labels = None
depends_on = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _has_table(inspector: sa.Inspector, table: str) -> bool:
    return table in inspector.get_table_names()


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(col["name"] == column for col in inspector.get_columns(table))


def _has_index(inspector: sa.Inspector, table: str, index: str) -> bool:
    return any(idx["name"] == index for idx in inspector.get_indexes(table))


def _has_fk(inspector: sa.Inspector, table: str, fk_name: str) -> bool:
    return any(fk["name"] == fk_name for fk in inspector.get_foreign_keys(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "device_notification_subscriptions"):
        op.create_table(
            "device_notification_subscriptions",
            sa.Column("subscription_id", sa.String(), nullable=False),
            sa.Column("device_id", sa.String(), nullable=False),
            sa.Column("endpoint_id", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
            sa.ForeignKeyConstraint(
                ["endpoint_id"],
                ["notification_endpoints.endpoint_id"],
            ),
            sa.PrimaryKeyConstraint("subscription_id"),
            sa.UniqueConstraint(
                "device_id",
                "endpoint_id",
                name="uq_device_notification_subscriptions_device_endpoint",
            ),
        )
        inspector = sa.inspect(bind)

    if not _has_index(
        inspector,
        "device_notification_subscriptions",
        "ix_device_notification_subscriptions_device_id",
    ):
        op.create_index(
            "ix_device_notification_subscriptions_device_id",
            "device_notification_subscriptions",
            ["device_id"],
        )
    if not _has_index(
        inspector,
        "device_notification_subscriptions",
        "ix_device_notification_subscriptions_endpoint_id",
    ):
        op.create_index(
            "ix_device_notification_subscriptions_endpoint_id",
            "device_notification_subscriptions",
            ["endpoint_id"],
        )

    inspector = sa.inspect(bind)
    if (
        not _has_table(inspector, "devices")
        or not _has_table(inspector, "device_notification_subscriptions")
        or not _has_column(inspector, "devices", "telegram_endpoint_id")
    ):
        return

    metadata = sa.MetaData()
    devices = sa.Table("devices", metadata, autoload_with=bind)
    subscriptions = sa.Table(
        "device_notification_subscriptions",
        metadata,
        autoload_with=bind,
    )

    rows = bind.execute(
        sa.select(
            devices.c.device_id,
            devices.c.telegram_endpoint_id,
            devices.c.telegram_linked_at,
        ).where(devices.c.telegram_endpoint_id.is_not(None))
    ).mappings()

    for row in rows:
        existing_id = bind.execute(
            sa.select(subscriptions.c.subscription_id).where(
                subscriptions.c.device_id == row["device_id"],
                subscriptions.c.endpoint_id == row["telegram_endpoint_id"],
            )
        ).scalar_one_or_none()
        if existing_id is not None:
            continue

        bind.execute(
            sa.insert(subscriptions).values(
                subscription_id=str(uuid4()),
                device_id=row["device_id"],
                endpoint_id=row["telegram_endpoint_id"],
                created_at=row["telegram_linked_at"] or _utc_now(),
            )
        )

    inspector = sa.inspect(bind)
    with op.batch_alter_table("devices") as batch_op:
        if _has_fk(
            inspector,
            "devices",
            "fk_devices_telegram_endpoint_id_notification_endpoints",
        ):
            batch_op.drop_constraint(
                "fk_devices_telegram_endpoint_id_notification_endpoints",
                type_="foreignkey",
            )
        if _has_index(inspector, "devices", "ix_devices_telegram_endpoint_id"):
            batch_op.drop_index("ix_devices_telegram_endpoint_id")
        if _has_column(inspector, "devices", "telegram_endpoint_id"):
            batch_op.drop_column("telegram_endpoint_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "devices"):
        with op.batch_alter_table("devices") as batch_op:
            if not _has_column(inspector, "devices", "telegram_endpoint_id"):
                batch_op.add_column(sa.Column("telegram_endpoint_id", sa.String(), nullable=True))
            if not _has_index(inspector, "devices", "ix_devices_telegram_endpoint_id"):
                batch_op.create_index("ix_devices_telegram_endpoint_id", ["telegram_endpoint_id"])
            if not _has_fk(
                inspector,
                "devices",
                "fk_devices_telegram_endpoint_id_notification_endpoints",
            ):
                batch_op.create_foreign_key(
                    "fk_devices_telegram_endpoint_id_notification_endpoints",
                    "notification_endpoints",
                    ["telegram_endpoint_id"],
                    ["endpoint_id"],
                )

    inspector = sa.inspect(bind)
    if _has_table(inspector, "devices") and _has_table(
        inspector, "device_notification_subscriptions"
    ):
        metadata = sa.MetaData()
        devices = sa.Table("devices", metadata, autoload_with=bind)
        subscriptions = sa.Table(
            "device_notification_subscriptions",
            metadata,
            autoload_with=bind,
        )

        rows = bind.execute(
            sa.select(
                subscriptions.c.device_id,
                subscriptions.c.endpoint_id,
                subscriptions.c.created_at,
                subscriptions.c.subscription_id,
            ).order_by(
                subscriptions.c.device_id,
                subscriptions.c.created_at.desc(),
                subscriptions.c.subscription_id.desc(),
            )
        ).mappings()

        seen_device_ids: set[str] = set()
        for row in rows:
            device_id = row["device_id"]
            if device_id in seen_device_ids:
                continue
            seen_device_ids.add(device_id)
            bind.execute(
                sa.update(devices)
                .where(devices.c.device_id == device_id)
                .values(telegram_endpoint_id=row["endpoint_id"])
            )

    inspector = sa.inspect(bind)
    if _has_table(inspector, "device_notification_subscriptions"):
        if _has_index(
            inspector,
            "device_notification_subscriptions",
            "ix_device_notification_subscriptions_endpoint_id",
        ):
            op.drop_index(
                "ix_device_notification_subscriptions_endpoint_id",
                table_name="device_notification_subscriptions",
            )
        if _has_index(
            inspector,
            "device_notification_subscriptions",
            "ix_device_notification_subscriptions_device_id",
        ):
            op.drop_index(
                "ix_device_notification_subscriptions_device_id",
                table_name="device_notification_subscriptions",
            )
        op.drop_table("device_notification_subscriptions")
