"""add site_url to jira_configs

Revision ID: d1b2c354af1b
Revises: 002975bd3c88
Create Date: 2026-05-21 11:15:09.794988

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1b2c354af1b'
down_revision: Union[str, Sequence[str], None] = '002975bd3c88'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jira_configs",
        sa.Column("site_url", sa.String(length=500), nullable=True),
    )
    # Backfill: rows whose base_url is a normal Atlassian site URL get site_url = base_url.
    # Service-account rows (base_url like https://api.atlassian.com/...) are left NULL;
    # the user must re-enter site URL in settings to restore browse links.
    op.execute(
        """
        UPDATE jira_configs
           SET site_url = base_url
         WHERE base_url NOT LIKE 'https://api.atlassian.com/%'
           AND base_url NOT LIKE 'http://api.atlassian.com/%';
        """
    )


def downgrade() -> None:
    op.drop_column("jira_configs", "site_url")
