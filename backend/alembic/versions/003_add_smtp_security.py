"""Add smtp_security field to user_email_accounts table

Revision ID: 003
Revises: 002
Create Date: 2026-02-23 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add smtp_security column with default value
    op.add_column('user_email_accounts', sa.Column('smtp_security', sa.String, server_default='STARTTLS', nullable=False))


def downgrade() -> None:
    op.drop_column('user_email_accounts', 'smtp_security')
