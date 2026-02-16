"""add telegram fields to devices

Revision ID: 0008_device_telegram_chat_link
Revises: 0007_event_alert_fields
Create Date: 2026-02-14

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0008_device_telegram_chat_link"
down_revision = "0007_event_alert_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.add_column(sa.Column("telegram_chat_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("telegram_username", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("telegram_linked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.drop_column("telegram_linked_at")
        batch_op.drop_column("telegram_username")
        batch_op.drop_column("telegram_chat_id")
