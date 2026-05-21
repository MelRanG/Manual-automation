"""add_link_path_to_notifications

Revision ID: 7de9b05a3c28
Revises: d1b2c354af1b
Create Date: 2026-05-21 15:37:37.451807

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7de9b05a3c28'
down_revision: Union[str, Sequence[str], None] = 'd1b2c354af1b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("link_path", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notifications", "link_path")
