"""drop empty chat sessions

Revision ID: e1f2a3b4c5d6
Revises: 7de9b05a3c28
Create Date: 2026-05-21 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "7de9b05a3c28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM chat_sessions
         WHERE id NOT IN (
           SELECT DISTINCT session_id FROM chat_messages
            WHERE session_id IS NOT NULL
         )
        """
    )


def downgrade() -> None:
    # Irreversible cleanup; nothing to restore.
    pass
