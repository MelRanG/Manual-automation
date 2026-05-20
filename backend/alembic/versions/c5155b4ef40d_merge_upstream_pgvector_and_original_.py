"""merge_upstream_pgvector_and_original_file_path

Revision ID: c5155b4ef40d
Revises: 71657cac9b75, d4e5f6a7b8c9
Create Date: 2026-05-20 12:39:17.532585

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5155b4ef40d'
down_revision: Union[str, Sequence[str], None] = ('71657cac9b75', 'd4e5f6a7b8c9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
