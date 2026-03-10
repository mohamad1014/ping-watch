"""expand event lifecycle states

Revision ID: 0013_event_lifecycle_states
Revises: 0012_device_notify_subs
Create Date: 2026-03-10

"""

from alembic import op


revision = "0013_event_lifecycle_states"
down_revision = "0012_device_notify_subs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_constraint("ck_events_status", type_="check")
        batch_op.create_check_constraint(
            "ck_events_status",
            "status IN ('queued', 'processing', 'done', 'failed', 'canceled')",
        )


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_constraint("ck_events_status", type_="check")
        batch_op.create_check_constraint(
            "ck_events_status",
            "status IN ('processing', 'done')",
        )
