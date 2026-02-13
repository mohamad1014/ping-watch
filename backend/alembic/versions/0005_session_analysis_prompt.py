"""add analysis_prompt to sessions

Revision ID: 0005_session_analysis_prompt
Revises: 0004_devices
Create Date: 2026-02-05

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005_session_analysis_prompt"
down_revision = "0004_devices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.add_column(sa.Column("analysis_prompt", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.drop_column("analysis_prompt")
