"""compatibility stub for stale wave-1 event lifecycle revision

Revision ID: 0012_event_lifecycle_states
Revises: 0011_notification_endpoints
Create Date: 2026-03-10

"""


revision = "0012_event_lifecycle_states"
down_revision = "0011_notification_endpoints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This revision existed on a parallel branch before the histories were
    # reconciled. Keep it as a no-op so databases stamped with the old
    # revision id can still upgrade cleanly to the merged head.
    return None


def downgrade() -> None:
    return None
