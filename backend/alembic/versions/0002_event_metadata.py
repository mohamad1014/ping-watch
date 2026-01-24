"""add event metadata and constraints

Revision ID: 0002_event_metadata
Revises: 0001_initial
Create Date: 2026-01-24

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0002_event_metadata"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.create_check_constraint(
            "ck_sessions_status", "status IN ('active', 'stopped')"
        )
        batch_op.create_index("ix_sessions_status", ["status"])

    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("duration_seconds", sa.Float(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("clip_uri", sa.String(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("clip_mime", sa.String(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("clip_size_bytes", sa.Integer(), nullable=False, server_default="0"))
        batch_op.create_check_constraint(
            "ck_events_status", "status IN ('processing', 'done')"
        )
        batch_op.create_check_constraint(
            "ck_events_duration", "duration_seconds >= 0"
        )
        batch_op.create_index("ix_events_session_id", ["session_id"])
        batch_op.create_index("ix_events_device_id", ["device_id"])
        batch_op.create_index("ix_events_status", ["status"])

    with op.batch_alter_table("events") as batch_op:
        batch_op.alter_column("duration_seconds", server_default=None)
        batch_op.alter_column("clip_uri", server_default=None)
        batch_op.alter_column("clip_mime", server_default=None)
        batch_op.alter_column("clip_size_bytes", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_index("ix_events_status")
        batch_op.drop_index("ix_events_device_id")
        batch_op.drop_index("ix_events_session_id")
        batch_op.drop_constraint("ck_events_duration", type_="check")
        batch_op.drop_constraint("ck_events_status", type_="check")
        batch_op.drop_column("clip_size_bytes")
        batch_op.drop_column("clip_mime")
        batch_op.drop_column("clip_uri")
        batch_op.drop_column("duration_seconds")

    with op.batch_alter_table("sessions") as batch_op:
        batch_op.drop_index("ix_sessions_status")
        batch_op.drop_constraint("ck_sessions_status", type_="check")
