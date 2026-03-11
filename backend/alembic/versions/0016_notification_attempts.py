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


def upgrade() -> None:
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
    op.create_index(
        "ix_notification_attempts_event_id",
        "notification_attempts",
        ["event_id"],
    )
    op.create_index(
        "ix_notification_attempts_provider",
        "notification_attempts",
        ["provider"],
    )
    op.create_index(
        "ix_notification_attempts_status",
        "notification_attempts",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_notification_attempts_status", table_name="notification_attempts")
    op.drop_index("ix_notification_attempts_provider", table_name="notification_attempts")
    op.drop_index("ix_notification_attempts_event_id", table_name="notification_attempts")
    op.drop_table("notification_attempts")
