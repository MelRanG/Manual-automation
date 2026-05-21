"""add_action_and_edited_content_to_approval_requests

Revision ID: 45b673d87854
Revises: e1f2a3b4c5d6
Create Date: 2026-05-22 02:23:53.881072

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '45b673d87854'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('approval_requests', sa.Column('action', sa.String(length=50), nullable=True))
    op.add_column('approval_requests', sa.Column('edited_content', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('approval_requests', 'edited_content')
    op.drop_column('approval_requests', 'action')
