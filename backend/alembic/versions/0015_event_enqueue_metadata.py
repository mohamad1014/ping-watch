"""add event enqueue metadata

Revision ID: 0015_event_enqueue_meta
Revises: 0014_merge_wave1_heads
Create Date: 2026-03-11

"""

from alembic import op
import sqlalchemy as sa


revision = "0015_event_enqueue_meta"
down_revision = "0014_merge_wave1_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("queue_job_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("enqueued_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(
            sa.Column(
                "enqueue_attempt_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("enqueue_attempt_count")
        batch_op.drop_column("enqueued_at")
        batch_op.drop_column("queue_job_id")
