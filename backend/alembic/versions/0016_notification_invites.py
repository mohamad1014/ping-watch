"""add notification invite lifecycle tables

Revision ID: 0016_notification_invites
Revises: 0015_event_enqueue_metadata
Create Date: 2026-03-11

"""

import sqlalchemy as sa
from alembic import op


revision = "0016_notification_invites"
down_revision = "0015_event_enqueue_meta"
branch_labels = None
depends_on = None


def _has_table(inspector: sa.Inspector, table: str) -> bool:
    return table in inspector.get_table_names()


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(col["name"] == column for col in inspector.get_columns(table))


def _has_index(inspector: sa.Inspector, table: str, index: str) -> bool:
    return any(idx["name"] == index for idx in inspector.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "notification_invites"):
        op.create_table(
            "notification_invites",
            sa.Column("invite_id", sa.String(), nullable=False),
            sa.Column("device_id", sa.String(), nullable=False),
            sa.Column("owner_user_id", sa.String(), nullable=False),
            sa.Column("recipient_user_id", sa.String(), nullable=True),
            sa.Column("accepted_endpoint_id", sa.String(), nullable=True),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "status IN ('pending', 'accepted', 'revoked', 'expired')",
                name="ck_notification_invites_status",
            ),
            sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
            sa.ForeignKeyConstraint(["owner_user_id"], ["users.user_id"]),
            sa.ForeignKeyConstraint(["recipient_user_id"], ["users.user_id"]),
            sa.ForeignKeyConstraint(
                ["accepted_endpoint_id"], ["notification_endpoints.endpoint_id"]
            ),
            sa.PrimaryKeyConstraint("invite_id"),
            sa.UniqueConstraint("token_hash"),
        )
        inspector = sa.inspect(bind)

    for index_name, column_name in (
        ("ix_notification_invites_device_id", "device_id"),
        ("ix_notification_invites_owner_user_id", "owner_user_id"),
        ("ix_notification_invites_recipient_user_id", "recipient_user_id"),
        ("ix_notification_invites_accepted_endpoint_id", "accepted_endpoint_id"),
        ("ix_notification_invites_token_hash", "token_hash"),
        ("ix_notification_invites_status", "status"),
    ):
        if not _has_index(inspector, "notification_invites", index_name):
            op.create_index(index_name, "notification_invites", [column_name])

    inspector = sa.inspect(bind)
    if _has_table(inspector, "telegram_link_attempts") and not _has_column(
        inspector, "telegram_link_attempts", "invite_id"
    ):
        with op.batch_alter_table("telegram_link_attempts") as batch_op:
            batch_op.add_column(sa.Column("invite_id", sa.String(), nullable=True))
            batch_op.create_index("ix_telegram_link_attempts_invite_id", ["invite_id"])
            batch_op.create_foreign_key(
                "fk_telegram_link_attempts_invite_id_notification_invites",
                "notification_invites",
                ["invite_id"],
                ["invite_id"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "telegram_link_attempts") and _has_column(
        inspector, "telegram_link_attempts", "invite_id"
    ):
        with op.batch_alter_table("telegram_link_attempts") as batch_op:
            batch_op.drop_constraint(
                "fk_telegram_link_attempts_invite_id_notification_invites",
                type_="foreignkey",
            )
            batch_op.drop_index("ix_telegram_link_attempts_invite_id")
            batch_op.drop_column("invite_id")

    inspector = sa.inspect(bind)
    if _has_table(inspector, "notification_invites"):
        for index_name in (
            "ix_notification_invites_status",
            "ix_notification_invites_token_hash",
            "ix_notification_invites_accepted_endpoint_id",
            "ix_notification_invites_recipient_user_id",
            "ix_notification_invites_owner_user_id",
            "ix_notification_invites_device_id",
        ):
            if _has_index(inspector, "notification_invites", index_name):
                op.drop_index(index_name, table_name="notification_invites")
        op.drop_table("notification_invites")
