from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class KBArticleCreate(BaseModel):
    title: str
    slug: str
    content_html: str
    category: Optional[str] = None
    published: bool = False


class KBArticleUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    content_html: Optional[str] = None
    category: Optional[str] = None
    published: Optional[bool] = None


class KBArticleResponse(BaseModel):
    id: int
    title: str
    slug: str
    content_html: str
    category: Optional[str] = None
    published: bool
    views: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class KBArticleSummary(BaseModel):
    """Lightweight version without content_html for lists."""
    id: int
    title: str
    slug: str
    category: Optional[str] = None
    published: bool
    views: int
    created_at: datetime

    class Config:
        from_attributes = True
