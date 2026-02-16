"""add inference provider/model to events

Revision ID: 0006_event_inference_metadata
Revises: 0005_session_analysis_prompt
Create Date: 2026-02-13

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0006_event_inference_metadata"
down_revision = "0005_session_analysis_prompt"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("inference_provider", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("inference_model", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("inference_model")
        batch_op.drop_column("inference_provider")
