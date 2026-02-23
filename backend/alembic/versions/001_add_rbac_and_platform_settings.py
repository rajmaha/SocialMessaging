"""
Migration: Add role-based access control and platform settings

This migration:
1. Adds role, is_active, and created_by columns to the User table
2. Creates the PlatformSettings table for storing platform credentials

Run with: alembic upgrade head
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, Boolean, Integer, JSON, func, DateTime

def upgrade():
    # Add columns to User table
    op.add_column('user', sa.Column('role', String, nullable=False, server_default='user'))
    op.add_column('user', sa.Column('is_active', Boolean, nullable=False, server_default=True))
    op.add_column('user', sa.Column('created_by', Integer, nullable=True))
    
    # Create PlatformSettings table
    op.create_table(
        'platform_settings',
        sa.Column('id', Integer, primary_key=True),
        sa.Column('platform', String, unique=True, nullable=False),
        sa.Column('app_id', String, nullable=True),
        sa.Column('app_secret', String, nullable=True),
        sa.Column('access_token', String, nullable=True),
        sa.Column('verify_token', String, nullable=True),
        sa.Column('business_account_id', String, nullable=True),
        sa.Column('phone_number', String, nullable=True),
        sa.Column('phone_number_id', String, nullable=True),
        sa.Column('organization_id', String, nullable=True),
        sa.Column('page_id', String, nullable=True),
        sa.Column('config', JSON, nullable=True),
        sa.Column('is_configured', Integer, nullable=False, server_default='0'),
        sa.Column('webhook_registered', Integer, nullable=False, server_default='0'),
        sa.Column('created_at', DateTime, nullable=False, server_default=func.now()),
        sa.Column('updated_at', DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    )

def downgrade():
    # Drop PlatformSettings table
    op.drop_table('platform_settings')
    
    # Drop columns from User table
    op.drop_column('user', 'created_by')
    op.drop_column('user', 'is_active')
    op.drop_column('user', 'role')
