"""add clip upload fields

Revision ID: 0003_clip_upload_fields
Revises: 0002_event_metadata
Create Date: 2026-01-27

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0003_clip_upload_fields"
down_revision = "0002_event_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("clip_container", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("clip_blob_name", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("clip_uploaded_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(sa.Column("clip_etag", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("clip_etag")
        batch_op.drop_column("clip_uploaded_at")
        batch_op.drop_column("clip_blob_name")
        batch_op.drop_column("clip_container")

