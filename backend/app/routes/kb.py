import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_

from app.database import get_db
from app.models.kb import KBArticle
from app.models.user import User
from app.schemas.kb import KBArticleCreate, KBArticleUpdate, KBArticleResponse, KBArticleSummary
from app.dependencies import get_current_user

router = APIRouter(prefix="/kb", tags=["knowledge-base"])


def slugify(text: str) -> str:
    """Convert title to URL-safe slug."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text.strip('-')


# ===== ADMIN ENDPOINTS (authenticated) =====

@router.post("/articles", response_model=KBArticleResponse)
def create_article(
    article: KBArticleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Auto-generate slug if not provided or empty
    slug = article.slug.strip() if article.slug.strip() else slugify(article.title)
    # Ensure uniqueness
    base_slug = slug
    counter = 1
    while db.query(KBArticle).filter(KBArticle.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1

    db_article = KBArticle(
        title=article.title,
        slug=slug,
        content_html=article.content_html,
        category=article.category,
        published=article.published,
    )
    db.add(db_article)
    db.commit()
    db.refresh(db_article)
    return db_article


@router.get("/articles", response_model=list[KBArticleSummary])
def list_articles_admin(
    search: str = Query(None),
    category: str = Query(None),
    published: bool = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin: list all articles including drafts."""
    query = db.query(KBArticle)
    if search:
        query = query.filter(or_(
            KBArticle.title.ilike(f"%{search}%"),
            KBArticle.content_html.ilike(f"%{search}%"),
        ))
    if category:
        query = query.filter(KBArticle.category == category)
    if published is not None:
        query = query.filter(KBArticle.published == published)
    return query.order_by(desc(KBArticle.created_at)).all()


@router.get("/articles/{article_id}", response_model=KBArticleResponse)
def get_article_admin(
    article_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    article = db.query(KBArticle).filter(KBArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return article


@router.patch("/articles/{article_id}", response_model=KBArticleResponse)
def update_article(
    article_id: int,
    update: KBArticleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    article = db.query(KBArticle).filter(KBArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(article, field, value)
    article.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(article)
    return article


@router.delete("/articles/{article_id}")
def delete_article(
    article_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    article = db.query(KBArticle).filter(KBArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    db.delete(article)
    db.commit()
    return {"status": "deleted"}


# ===== PUBLIC ENDPOINTS (no auth) =====

@router.get("/public/articles", response_model=list[KBArticleSummary])
def list_articles_public(
    search: str = Query(None),
    category: str = Query(None),
    db: Session = Depends(get_db),
):
    """Public: list published articles only, with optional search."""
    query = db.query(KBArticle).filter(KBArticle.published == True)
    if search:
        query = query.filter(or_(
            KBArticle.title.ilike(f"%{search}%"),
            KBArticle.content_html.ilike(f"%{search}%"),
        ))
    if category:
        query = query.filter(KBArticle.category == category)
    return query.order_by(desc(KBArticle.views), desc(KBArticle.created_at)).all()


@router.get("/public/articles/{slug}", response_model=KBArticleResponse)
def get_article_by_slug(
    slug: str,
    db: Session = Depends(get_db),
):
    """Public: get a published article by slug, increment view count."""
    article = db.query(KBArticle).filter(
        KBArticle.slug == slug,
        KBArticle.published == True,
    ).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    article.views += 1
    db.commit()
    db.refresh(article)
    return article


@router.get("/public/categories")
def list_categories_public(db: Session = Depends(get_db)):
    """Public: list distinct categories that have published articles."""
    results = db.query(KBArticle.category).filter(
        KBArticle.published == True,
        KBArticle.category.isnot(None),
    ).distinct().all()
    return [r[0] for r in results if r[0]]
