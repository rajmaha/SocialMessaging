"""Add thread_id column to emails table

Revision ID: 002
Revises: 001_add_rbac_and_platform_settings
Create Date: 2025-02-22 18:31:18.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001_add_rbac_and_platform_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add thread_id column to emails table
    op.add_column('emails', sa.Column('thread_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_emails_thread_id', 'emails', 'email_threads', ['thread_id'], ['id'])


def downgrade() -> None:
    # Remove the foreign key and column
    op.drop_constraint('fk_emails_thread_id', 'emails', type_='foreignkey')
    op.drop_column('emails', 'thread_id')
