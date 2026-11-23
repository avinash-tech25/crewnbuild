"""Viswa, the help assistant: stored chats of signed-in users (guests are not stored).

    assistant_conversations   one per user; goes with the user (CASCADE)
    assistant_messages        questions and answers; go with their conversation (CASCADE)

Kept for ASSISTANT_HISTORY_DAYS and purged by the scheduler. downgrade drops both tables
(chat history only).
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

SCHEMA = "professional"


def upgrade() -> None:
    op.create_table(
        "assistant_conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_assistant_conversations__user_id__users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assistant_conversations")),
        sa.UniqueConstraint("user_id", name=op.f("uq_assistant_conversations__user_id")),
        schema=SCHEMA,
    )
    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("answer_type", sa.String(length=30)),
        sa.Column("tools_used", sa.JSON()),
        sa.Column("buttons", sa.JSON()),
        sa.Column("vote", sa.String(length=4)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant')", name=op.f("ck_assistant_messages__role")),
        sa.CheckConstraint("vote IS NULL OR vote IN ('up', 'down')", name=op.f("ck_assistant_messages__vote")),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            [f"{SCHEMA}.assistant_conversations.id"],
            name=op.f("fk_assistant_messages__conversation_id__assistant_conversations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assistant_messages")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_assistant_messages__conversation_id_created_at",
        "assistant_messages",
        ["conversation_id", "created_at"],
        schema=SCHEMA,
    )
    op.create_index("ix_assistant_messages__created_at", "assistant_messages", ["created_at"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_index("ix_assistant_messages__created_at", table_name="assistant_messages", schema=SCHEMA)
    op.drop_index("ix_assistant_messages__conversation_id_created_at", table_name="assistant_messages", schema=SCHEMA)
    op.drop_table("assistant_messages", schema=SCHEMA)
    op.drop_table("assistant_conversations", schema=SCHEMA)
