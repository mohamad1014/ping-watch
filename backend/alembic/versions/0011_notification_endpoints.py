"""add telegram notification endpoints and device endpoint mapping

Revision ID: 0011_notification_endpoints
Revises: 0010_auth_sessions
Create Date: 2026-02-16

"""

from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0011_notification_endpoints"
down_revision = "0010_auth_sessions"
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

    if not _has_table(inspector, "notification_endpoints"):
        op.create_table(
            "notification_endpoints",
            sa.Column("endpoint_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=True),
            sa.Column("provider", sa.String(), nullable=False),
            sa.Column("chat_id", sa.String(), nullable=False),
            sa.Column("telegram_username", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "provider = 'telegram'",
                name="ck_notification_endpoints_provider",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.user_id"]),
            sa.PrimaryKeyConstraint("endpoint_id"),
            sa.UniqueConstraint(
                "provider",
                "chat_id",
                name="uq_notification_endpoints_provider_chat",
            ),
        )
        inspector = sa.inspect(bind)

    if not _has_index(inspector, "notification_endpoints", "ix_notification_endpoints_user_id"):
        op.create_index(
            "ix_notification_endpoints_user_id",
            "notification_endpoints",
            ["user_id"],
        )
    if not _has_index(
        inspector, "notification_endpoints", "ix_notification_endpoints_provider"
    ):
        op.create_index(
            "ix_notification_endpoints_provider",
            "notification_endpoints",
            ["provider"],
        )
    if not _has_index(
        inspector, "notification_endpoints", "ix_notification_endpoints_chat_id"
    ):
        op.create_index(
            "ix_notification_endpoints_chat_id",
            "notification_endpoints",
            ["chat_id"],
        )

    with op.batch_alter_table("devices") as batch_op:
        if not _has_column(inspector, "devices", "telegram_endpoint_id"):
            batch_op.add_column(sa.Column("telegram_endpoint_id", sa.String(), nullable=True))
        if not _has_index(inspector, "devices", "ix_devices_telegram_endpoint_id"):
            batch_op.create_index("ix_devices_telegram_endpoint_id", ["telegram_endpoint_id"])
        if not _has_fk(
            inspector, "devices", "fk_devices_telegram_endpoint_id_notification_endpoints"
        ):
            batch_op.create_foreign_key(
                "fk_devices_telegram_endpoint_id_notification_endpoints",
                "notification_endpoints",
                ["telegram_endpoint_id"],
                ["endpoint_id"],
            )

    inspector = sa.inspect(bind)
    if not _has_table(inspector, "devices") or not _has_table(
        inspector, "notification_endpoints"
    ):
        return
    if not _has_column(inspector, "devices", "telegram_chat_id") or not _has_column(
        inspector, "devices", "telegram_endpoint_id"
    ):
        return

    metadata = sa.MetaData()
    devices = sa.Table("devices", metadata, autoload_with=bind)
    endpoints = sa.Table("notification_endpoints", metadata, autoload_with=bind)

    rows = bind.execute(
        sa.select(
            devices.c.device_id,
            devices.c.user_id,
            devices.c.telegram_chat_id,
            devices.c.telegram_username,
            devices.c.telegram_linked_at,
        ).where(
            devices.c.telegram_chat_id.is_not(None),
            devices.c.telegram_endpoint_id.is_(None),
        )
    ).mappings()

    for row in rows:
        chat_id = str(row["telegram_chat_id"]).strip()
        if not chat_id:
            continue

        endpoint_id = bind.execute(
            sa.select(endpoints.c.endpoint_id).where(
                endpoints.c.provider == "telegram",
                endpoints.c.chat_id == chat_id,
            )
        ).scalar_one_or_none()
        if endpoint_id is None:
            linked_at = row["telegram_linked_at"] or _utc_now()
            endpoint_id = str(uuid4())
            bind.execute(
                sa.insert(endpoints).values(
                    endpoint_id=endpoint_id,
                    user_id=row["user_id"],
                    provider="telegram",
                    chat_id=chat_id,
                    telegram_username=row["telegram_username"],
                    created_at=linked_at,
                    linked_at=linked_at,
                )
            )

        bind.execute(
            sa.update(devices)
            .where(devices.c.device_id == row["device_id"])
            .values(telegram_endpoint_id=endpoint_id)
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "devices"):
        with op.batch_alter_table("devices") as batch_op:
            if _has_fk(
                inspector, "devices", "fk_devices_telegram_endpoint_id_notification_endpoints"
            ):
                batch_op.drop_constraint(
                    "fk_devices_telegram_endpoint_id_notification_endpoints",
                    type_="foreignkey",
                )
            if _has_index(inspector, "devices", "ix_devices_telegram_endpoint_id"):
                batch_op.drop_index("ix_devices_telegram_endpoint_id")
            if _has_column(inspector, "devices", "telegram_endpoint_id"):
                batch_op.drop_column("telegram_endpoint_id")

    inspector = sa.inspect(bind)
    if _has_table(inspector, "notification_endpoints"):
        if _has_index(inspector, "notification_endpoints", "ix_notification_endpoints_chat_id"):
            op.drop_index(
                "ix_notification_endpoints_chat_id",
                table_name="notification_endpoints",
            )
        if _has_index(inspector, "notification_endpoints", "ix_notification_endpoints_provider"):
            op.drop_index(
                "ix_notification_endpoints_provider",
                table_name="notification_endpoints",
            )
        if _has_index(inspector, "notification_endpoints", "ix_notification_endpoints_user_id"):
            op.drop_index(
                "ix_notification_endpoints_user_id",
                table_name="notification_endpoints",
            )
        op.drop_table("notification_endpoints")
