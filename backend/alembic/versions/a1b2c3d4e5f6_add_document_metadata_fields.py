"""add document metadata fields

Revision ID: a1b2c3d4e5f6
Revises: c3a8f201de77
Create Date: 2026-05-19 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "8db56e78aca3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("document_type", sa.String(50), nullable=True))
    op.add_column("documents", sa.Column("domain", sa.String(100), nullable=True))
    op.add_column("documents", sa.Column("audience", sa.String(50), nullable=True))
    op.add_column("documents", sa.Column("source_type", sa.String(50), nullable=True))
    op.add_column(
        "documents",
        sa.Column("related_sr_id", sa.UUID(), sa.ForeignKey("sr_drafts.id"), nullable=True),
    )
    op.add_column("documents", sa.Column("jira_issue_key", sa.String(50), nullable=True))
    op.create_index("ix_documents_jira_issue_key", "documents", ["jira_issue_key"])
    op.create_index("ix_documents_related_sr_id", "documents", ["related_sr_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_related_sr_id", table_name="documents")
    op.drop_index("ix_documents_jira_issue_key", table_name="documents")
    op.drop_column("documents", "jira_issue_key")
    op.drop_column("documents", "related_sr_id")
    op.drop_column("documents", "source_type")
    op.drop_column("documents", "audience")
    op.drop_column("documents", "domain")
    op.drop_column("documents", "document_type")
