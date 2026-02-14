"""add alert decision fields to events

Revision ID: 0007_event_alert_fields
Revises: 0006_event_inference_metadata
Create Date: 2026-02-13

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0007_event_alert_fields"
down_revision = "0006_event_inference_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("should_notify", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("alert_reason", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("matched_rules", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("detected_entities", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("detected_actions", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("detected_actions")
        batch_op.drop_column("detected_entities")
        batch_op.drop_column("matched_rules")
        batch_op.drop_column("alert_reason")
        batch_op.drop_column("should_notify")
