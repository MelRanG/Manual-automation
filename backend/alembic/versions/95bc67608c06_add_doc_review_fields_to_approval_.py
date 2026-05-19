"""add_doc_review_fields_to_approval_requests

Revision ID: 95bc67608c06
Revises: bde2f709c53d
Create Date: 2026-05-19 23:32:36.449494

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '95bc67608c06'
down_revision: Union[str, Sequence[str], None] = 'bde2f709c53d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('approval_requests', sa.Column('approval_type', sa.String(length=50), nullable=False, server_default='document_change'))
    op.add_column('approval_requests', sa.Column('sr_draft_id', sa.UUID(), nullable=True))
    op.alter_column('approval_requests', 'proposed_change_id',
               existing_type=sa.UUID(),
               nullable=True)
    op.create_foreign_key(None, 'approval_requests', 'sr_drafts', ['sr_draft_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(None, 'approval_requests', type_='foreignkey')
    op.alter_column('approval_requests', 'proposed_change_id',
               existing_type=sa.UUID(),
               nullable=False)
    op.drop_column('approval_requests', 'sr_draft_id')
    op.drop_column('approval_requests', 'approval_type')
