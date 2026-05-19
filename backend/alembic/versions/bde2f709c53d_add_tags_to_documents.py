"""add_tags_to_documents

Revision ID: bde2f709c53d
Revises: c43dcb6cf3ca
Create Date: 2026-05-20 00:36:40.277620

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as sa_pg


# revision identifiers, used by Alembic.
revision: str = 'bde2f709c53d'
down_revision: Union[str, Sequence[str], None] = 'c43dcb6cf3ca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('documents', sa.Column('tags', sa_pg.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('documents', 'tags')
