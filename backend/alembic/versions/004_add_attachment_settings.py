"""Add allowed_file_types and max_file_size_mb to branding_settings

Revision ID: 004
Revises: 003
Create Date: 2026-02-23 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('branding_settings', sa.Column('allowed_file_types', sa.JSON(), nullable=True))
    op.add_column('branding_settings', sa.Column('max_file_size_mb', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('branding_settings', 'max_file_size_mb')
    op.drop_column('branding_settings', 'allowed_file_types')
