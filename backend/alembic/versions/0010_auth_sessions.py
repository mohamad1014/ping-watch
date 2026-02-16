"""add users and auth sessions

Revision ID: 0010_auth_sessions
Revises: 0009_telegram_link_attempts
Create Date: 2026-02-16

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0010_auth_sessions"
down_revision = "0009_telegram_link_attempts"
branch_labels = None
depends_on = None


def _has_table(inspector: sa.Inspector, table: str) -> bool:
    return table in inspector.get_table_names()


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(col["name"] == column for col in inspector.get_columns(table))


def _has_index(inspector: sa.Inspector, table: str, index: str) -> bool:
    return any(idx["name"] == index for idx in inspector.get_indexes(table))


def _has_fk(inspector: sa.Inspector, table: str, fk_name: str) -> bool:
    return any(fk["name"] == fk_name for fk in inspector.get_foreign_keys(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "users"):
        op.create_table(
            "users",
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("email", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("user_id"),
            sa.UniqueConstraint("email"),
        )
        inspector = sa.inspect(bind)

    if not _has_table(inspector, "auth_sessions"):
        op.create_table(
            "auth_sessions",
            sa.Column("auth_session_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.user_id"]),
            sa.PrimaryKeyConstraint("auth_session_id"),
        )
        inspector = sa.inspect(bind)

    if not _has_index(inspector, "auth_sessions", "ix_auth_sessions_user_id"):
        op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    if not _has_index(inspector, "auth_sessions", "ix_auth_sessions_token_hash"):
        op.create_index(
            "ix_auth_sessions_token_hash",
            "auth_sessions",
            ["token_hash"],
            unique=True,
        )

    with op.batch_alter_table("devices") as batch_op:
        if not _has_column(inspector, "devices", "user_id"):
            batch_op.add_column(sa.Column("user_id", sa.String(), nullable=True))
        if not _has_index(inspector, "devices", "ix_devices_user_id"):
            batch_op.create_index("ix_devices_user_id", ["user_id"], unique=False)
        if not _has_fk(inspector, "devices", "fk_devices_user_id_users"):
            batch_op.create_foreign_key(
                "fk_devices_user_id_users",
                "users",
                ["user_id"],
                ["user_id"],
            )

    with op.batch_alter_table("sessions") as batch_op:
        if not _has_column(inspector, "sessions", "user_id"):
            batch_op.add_column(sa.Column("user_id", sa.String(), nullable=True))
        if not _has_index(inspector, "sessions", "ix_sessions_user_id"):
            batch_op.create_index("ix_sessions_user_id", ["user_id"], unique=False)
        if not _has_fk(inspector, "sessions", "fk_sessions_user_id_users"):
            batch_op.create_foreign_key(
                "fk_sessions_user_id_users",
                "users",
                ["user_id"],
                ["user_id"],
            )

    with op.batch_alter_table("events") as batch_op:
        if not _has_column(inspector, "events", "user_id"):
            batch_op.add_column(sa.Column("user_id", sa.String(), nullable=True))
        if not _has_index(inspector, "events", "ix_events_user_id"):
            batch_op.create_index("ix_events_user_id", ["user_id"], unique=False)
        if not _has_fk(inspector, "events", "fk_events_user_id_users"):
            batch_op.create_foreign_key(
                "fk_events_user_id_users",
                "users",
                ["user_id"],
                ["user_id"],
            )

    with op.batch_alter_table("telegram_link_attempts") as batch_op:
        if not _has_column(inspector, "telegram_link_attempts", "user_id"):
            batch_op.add_column(sa.Column("user_id", sa.String(), nullable=True))
        if not _has_index(
            inspector,
            "telegram_link_attempts",
            "ix_telegram_link_attempts_user_id",
        ):
            batch_op.create_index(
                "ix_telegram_link_attempts_user_id",
                ["user_id"],
                unique=False,
            )
        if not _has_fk(
            inspector,
            "telegram_link_attempts",
            "fk_telegram_link_attempts_user_id_users",
        ):
            batch_op.create_foreign_key(
                "fk_telegram_link_attempts_user_id_users",
                "users",
                ["user_id"],
                ["user_id"],
            )


def downgrade() -> None:
    with op.batch_alter_table("telegram_link_attempts") as batch_op:
        batch_op.drop_constraint(
            "fk_telegram_link_attempts_user_id_users",
            type_="foreignkey",
        )
        batch_op.drop_index("ix_telegram_link_attempts_user_id")
        batch_op.drop_column("user_id")

    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_constraint("fk_events_user_id_users", type_="foreignkey")
        batch_op.drop_index("ix_events_user_id")
        batch_op.drop_column("user_id")

    with op.batch_alter_table("sessions") as batch_op:
        batch_op.drop_constraint("fk_sessions_user_id_users", type_="foreignkey")
        batch_op.drop_index("ix_sessions_user_id")
        batch_op.drop_column("user_id")

    with op.batch_alter_table("devices") as batch_op:
        batch_op.drop_constraint("fk_devices_user_id_users", type_="foreignkey")
        batch_op.drop_index("ix_devices_user_id")
        batch_op.drop_column("user_id")

    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("users")
