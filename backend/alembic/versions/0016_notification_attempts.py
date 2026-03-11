"""add notification attempts

Revision ID: 0016_notification_attempts
Revises: 0015_event_enqueue_meta
Create Date: 2026-03-11

"""

from alembic import op
import sqlalchemy as sa


revision = "0016_notification_attempts"
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

    if not _has_table(inspector, "notification_attempts"):
        op.create_table(
            "notification_attempts",
            sa.Column("attempt_id", sa.String(), nullable=False),
            sa.Column("event_id", sa.String(), nullable=False),
            sa.Column("provider", sa.String(), nullable=False),
            sa.Column("recipient", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("failure_reason", sa.Text(), nullable=True),
            sa.Column("retryable", sa.Boolean(), nullable=False),
            sa.Column("attempt_number", sa.Integer(), nullable=False),
            sa.Column("max_attempts", sa.Integer(), nullable=False),
            sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["event_id"], ["events.event_id"]),
            sa.PrimaryKeyConstraint("attempt_id"),
            sa.CheckConstraint(
                "provider IN ('telegram', 'webhook')",
                name="ck_notification_attempts_provider",
            ),
            sa.CheckConstraint(
                "status IN ('succeeded', 'failed')",
                name="ck_notification_attempts_status",
            ),
            sa.CheckConstraint(
                "attempt_number >= 1",
                name="ck_notification_attempts_attempt_number",
            ),
            sa.CheckConstraint(
                "max_attempts >= attempt_number",
                name="ck_notification_attempts_max_attempts",
            ),
        )
        inspector = sa.inspect(bind)

    required_columns = {
        "attempt_id",
        "event_id",
        "provider",
        "recipient",
        "status",
        "failure_reason",
        "retryable",
        "attempt_number",
        "max_attempts",
        "attempted_at",
        "finished_at",
        "next_retry_at",
    }
    existing_columns = {col["name"] for col in inspector.get_columns("notification_attempts")}
    missing = sorted(required_columns - existing_columns)
    if missing:
        raise RuntimeError(
            "Existing `notification_attempts` table is missing expected columns: "
            + ", ".join(missing)
        )

    for index_name, column_name in (
        ("ix_notification_attempts_event_id", "event_id"),
        ("ix_notification_attempts_provider", "provider"),
        ("ix_notification_attempts_status", "status"),
    ):
        if not _has_index(inspector, "notification_attempts", index_name):
            op.create_index(index_name, "notification_attempts", [column_name])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_table(inspector, "notification_attempts"):
        return

    if _has_index(inspector, "notification_attempts", "ix_notification_attempts_status"):
        op.drop_index("ix_notification_attempts_status", table_name="notification_attempts")
    if _has_index(inspector, "notification_attempts", "ix_notification_attempts_provider"):
        op.drop_index("ix_notification_attempts_provider", table_name="notification_attempts")
    if _has_index(inspector, "notification_attempts", "ix_notification_attempts_event_id"):
        op.drop_index("ix_notification_attempts_event_id", table_name="notification_attempts")
    op.drop_table("notification_attempts")
