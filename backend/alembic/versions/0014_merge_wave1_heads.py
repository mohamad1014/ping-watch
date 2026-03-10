"""merge reconciled wave-1 migration histories

Revision ID: 0014_merge_wave1_heads
Revises: 0012_event_lifecycle_states, 0013_event_lifecycle_states
Create Date: 2026-03-10

"""


revision = "0014_merge_wave1_heads"
down_revision = ("0012_event_lifecycle_states", "0013_event_lifecycle_states")
branch_labels = None
depends_on = None


def upgrade() -> None:
    return None


def downgrade() -> None:
    return None
