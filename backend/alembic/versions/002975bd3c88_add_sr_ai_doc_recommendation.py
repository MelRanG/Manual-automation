"""add sr ai_doc_recommendation

Revision ID: 002975bd3c88
Revises: 5e9dc43fefb5
Create Date: 2026-05-21 07:52:53.811791

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '002975bd3c88'
down_revision: Union[str, Sequence[str], None] = '5e9dc43fefb5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'sr_drafts',
        sa.Column(
            'ai_doc_recommendation',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column('sr_drafts', 'ai_doc_recommendation')
