"""add telegram link attempts table

Revision ID: 0009_telegram_link_attempts
Revises: 0008_device_telegram_chat_link
Create Date: 2026-02-15

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0009_telegram_link_attempts"
down_revision = "0008_device_telegram_chat_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_name = "telegram_link_attempts"

    if table_name not in inspector.get_table_names():
        op.create_table(
            table_name,
            sa.Column("attempt_id", sa.String(), nullable=False),
            sa.Column("device_id", sa.String(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("chat_id", sa.String(), nullable=True),
            sa.Column("telegram_username", sa.String(), nullable=True),
            sa.CheckConstraint(
                "status IN ('pending', 'linked', 'expired')",
                name="ck_telegram_link_attempts_status",
            ),
            sa.PrimaryKeyConstraint("attempt_id"),
        )

    inspector = sa.inspect(bind)
    existing_indexes = {
        index["name"] for index in inspector.get_indexes(table_name)
    } if table_name in inspector.get_table_names() else set()

    if "ix_telegram_link_attempts_device_id" not in existing_indexes:
        op.create_index(
            "ix_telegram_link_attempts_device_id",
            table_name,
            ["device_id"],
        )
    if "ix_telegram_link_attempts_token_hash" not in existing_indexes:
        op.create_index(
            "ix_telegram_link_attempts_token_hash",
            table_name,
            ["token_hash"],
            unique=True,
        )
    if "ix_telegram_link_attempts_status" not in existing_indexes:
        op.create_index(
            "ix_telegram_link_attempts_status",
            table_name,
            ["status"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_name = "telegram_link_attempts"
    if table_name not in inspector.get_table_names():
        return

    existing_indexes = {
        index["name"] for index in inspector.get_indexes(table_name)
    }
    if "ix_telegram_link_attempts_status" in existing_indexes:
        op.drop_index(
            "ix_telegram_link_attempts_status",
            table_name=table_name,
        )
    if "ix_telegram_link_attempts_token_hash" in existing_indexes:
        op.drop_index(
            "ix_telegram_link_attempts_token_hash",
            table_name=table_name,
        )
    if "ix_telegram_link_attempts_device_id" in existing_indexes:
        op.drop_index(
            "ix_telegram_link_attempts_device_id",
            table_name=table_name,
        )
    op.drop_table(table_name)
