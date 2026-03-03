# Knowledge Base Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a customer-facing searchable knowledge base at `/help` with admin article management and optional bot fallback integration.

**Architecture:** New `kb_articles` DB table (inline SQL migration). A `kb.py` router provides admin CRUD (authenticated) and public read endpoints (no auth). Frontend has an admin editor at `/admin/kb/` and a public portal at `/help` with search. The existing bot service gets a fallback: if no Q&A pair matches, search KB articles.

**Tech Stack:** FastAPI, SQLAlchemy ORM, Next.js 14 App Router, TypeScript, TailwindCSS.

**Note:** No Alembic. Migrations are inline SQL in `backend/main.py` using `text()` + `IF NOT EXISTS`. No Jest. Verify manually in browser.

---

### Task 1: Add KBArticle DB model and migration

**Files:**
- Create: `backend/app/models/kb.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/main.py`

**Step 1: Create `backend/app/models/kb.py`**

```python
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
from sqlalchemy.sql import func
from app.database import Base


class KBArticle(Base):
    __tablename__ = "kb_articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    slug = Column(String(500), unique=True, nullable=False)
    content_html = Column(Text, nullable=False)
    category = Column(String(255), nullable=True)
    published = Column(Boolean, default=False, nullable=False)
    views = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
```

**Step 2: Register in `backend/app/models/__init__.py`**

Add:
```python
from app.models.kb import KBArticle
```

**Step 3: Add inline SQL migration in `backend/main.py`**

Find the migration block (same area where campaigns migration was added). Add:

```python
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS kb_articles (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(500) NOT NULL,
                    slug VARCHAR(500) UNIQUE NOT NULL,
                    content_html TEXT NOT NULL,
                    category VARCHAR(255),
                    published BOOLEAN DEFAULT FALSE NOT NULL,
                    views INTEGER DEFAULT 0 NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                )
            """))
            conn.commit()
```

**Step 4: Verify**

Restart backend — no errors. Check logs for startup message.

**Step 5: Commit**

```bash
git add backend/app/models/kb.py backend/app/models/__init__.py backend/main.py
git commit -m "feat: add KBArticle model and inline SQL migration"
```

---

### Task 2: Create KB Pydantic schemas

**Files:**
- Create: `backend/app/schemas/kb.py`

**Step 1: Create the file**

```python
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
```

**Step 2: Commit**

```bash
git add backend/app/schemas/kb.py
git commit -m "feat: add KB article Pydantic schemas"
```

---

### Task 3: Create KB routes (admin + public)

**Files:**
- Create: `backend/app/routes/kb.py`
- Modify: `backend/main.py` (register router)

**Step 1: Create `backend/app/routes/kb.py`**

```python
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
```

**Step 2: Register in `backend/main.py`**

Add with other router imports and registrations:

```python
from app.routes.kb import router as kb_router
# ...
app.include_router(kb_router)
```

**Step 3: Verify**

Restart backend → http://localhost:8000/docs → confirm `/kb/articles` and `/kb/public/articles` endpoints appear.

**Step 4: Commit**

```bash
git add backend/app/routes/kb.py backend/main.py
git commit -m "feat: add KB admin CRUD and public read endpoints with search and slug"
```

---

### Task 4: Add KB to AdminNav

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Add KB nav items**

Find the `Applications` group in `AdminNav.tsx`. Add a new group or append to Applications:

```tsx
{
    label: 'Content',
    items: [
        { href: '/admin/kb', label: 'Knowledge Base', icon: '📚', permission: () => hasAdminFeature('manage_branding') },
    ],
},
```

Add this group BEFORE the `Business` group in the `sidebarGroups` array.

**Step 2: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: add Knowledge Base link to AdminNav Content group"
```

---

### Task 5: Build Admin KB Article List

**Files:**
- Create: `frontend/app/admin/kb/page.tsx`

**Step 1: Create the file**

```tsx
"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

export default function KBAdminPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const res = await axios.get(`${API_URL}/kb/articles?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setArticles(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchArticles(); }, [search]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this article?")) return;
    await axios.delete(`${API_URL}/kb/articles/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchArticles();
  };

  const handleTogglePublish = async (article: any) => {
    await axios.patch(`${API_URL}/kb/articles/${article.id}`, { published: !article.published }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchArticles();
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Knowledge Base</h1>
            <p className="text-sm text-gray-500 mt-0.5">{articles.length} articles</p>
          </div>
          <div className="flex gap-3">
            <a href="/help" target="_blank" rel="noreferrer" className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              View Public Portal →
            </a>
            <a href="/admin/kb/new" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
              + New Article
            </a>
          </div>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search articles…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : articles.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            <p className="mb-2">No articles yet.</p>
            <a href="/admin/kb/new" className="text-blue-600 hover:underline text-sm">Write your first article</a>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {["Title", "Category", "Status", "Views", "Created", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {articles.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.title}</td>
                    <td className="px-4 py-3 text-gray-500">{a.category || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        a.published ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}>
                        {a.published ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{a.views}</td>
                    <td className="px-4 py-3 text-gray-400">{new Date(a.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 text-sm">
                        <a href={`/admin/kb/${a.id}/edit`} className="text-amber-600 hover:underline">Edit</a>
                        <button onClick={() => handleTogglePublish(a)} className={a.published ? "text-gray-500 hover:underline" : "text-green-600 hover:underline"}>
                          {a.published ? "Unpublish" : "Publish"}
                        </button>
                        <a href={`/help/${a.slug}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View</a>
                        <button onClick={() => handleDelete(a.id)} className="text-red-600 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/kb/page.tsx
git commit -m "feat: add KB admin article list with publish toggle and search"
```

---

### Task 6: Build Admin KB Article Editor (New + Edit)

**Files:**
- Create: `frontend/app/admin/kb/new/page.tsx`
- Create: `frontend/app/admin/kb/[id]/edit/page.tsx`

**Step 1: Create `frontend/app/admin/kb/new/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";
import { useRouter } from "next/navigation";

export default function NewArticlePage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const router = useRouter();

  const [form, setForm] = useState({
    title: "",
    slug: "",
    content_html: "",
    category: "",
    published: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const autoSlug = (title: string) =>
    title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");

  const handleTitleChange = (title: string) => {
    setForm(prev => ({
      ...prev,
      title,
      slug: prev.slug === "" || prev.slug === autoSlug(prev.title) ? autoSlug(title) : prev.slug,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.content_html) {
      setError("Title and content are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await axios.post(`${API_URL}/kb/articles`, form, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push("/admin/kb");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 max-w-4xl">
        <a href="/admin/kb" className="text-gray-400 hover:text-gray-600 text-sm">← Knowledge Base</a>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2 mb-6">New Article</h1>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={e => handleTitleChange(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. How to reset your password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Slug (URL path)</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">/help/</span>
                <input
                  type="text"
                  value={form.slug}
                  onChange={e => setForm({ ...form, slug: e.target.value })}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
              <input
                type="text"
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Account, Billing, Getting Started"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Content (HTML) *</label>
              <textarea
                value={form.content_html}
                onChange={e => setForm({ ...form, content_html: e.target.value })}
                rows={16}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="<h2>Overview</h2><p>Your article content here...</p>"
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="published"
                checked={form.published}
                onChange={e => setForm({ ...form, published: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="published" className="text-sm text-gray-700">Publish immediately (visible on /help)</label>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
              {saving ? "Saving…" : "Save Article"}
            </button>
            <a href="/admin/kb" className="px-6 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</a>
          </div>
        </form>
      </main>
    </div>
  );
}
```

**Step 2: Create `frontend/app/admin/kb/[id]/edit/page.tsx`**

Clone the new article page with these changes:
- Add `const { id } = useParams()`
- Add `useEffect` to `GET /kb/articles/${id}` and populate `form`
- Change `axios.post` to `axios.patch(`${API_URL}/kb/articles/${id}`, ...)`
- Change heading to "Edit Article"

**Step 3: Commit**

```bash
git add frontend/app/admin/kb/
git commit -m "feat: add KB article new and edit pages with auto-slug generation"
```

---

### Task 7: Build Public Help Portal

**Files:**
- Create: `frontend/app/help/page.tsx`
- Create: `frontend/app/help/[slug]/page.tsx`

**Step 1: Create `frontend/app/help/page.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import { API_URL } from "@/lib/config";

export default function HelpPage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/kb/public/categories`)
      .then(r => r.json())
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (selectedCategory) params.set("category", selectedCategory);
    fetch(`${API_URL}/kb/public/articles?${params}`)
      .then(r => r.json())
      .then(data => { setArticles(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [search, selectedCategory]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Help Center</h1>
        <a href="/" className="text-sm text-blue-600 hover:underline">← Back to App</a>
      </div>

      {/* Hero search */}
      <div className="bg-indigo-600 text-white py-12 px-6 text-center">
        <h2 className="text-3xl font-bold mb-2">How can we help?</h2>
        <p className="text-indigo-200 mb-6">Search our knowledge base for answers</p>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search articles…"
          className="w-full max-w-lg px-5 py-3 rounded-xl text-gray-900 text-sm focus:outline-none shadow-lg"
          autoFocus
        />
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Category filters */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            <button
              onClick={() => setSelectedCategory("")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                selectedCategory === "" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat === selectedCategory ? "" : cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                  selectedCategory === cat ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Articles grid */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg mb-2">No articles found.</p>
            {search && <p className="text-sm">Try a different search term.</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {articles.map(a => (
              <a
                key={a.id}
                href={`/help/${a.slug}`}
                className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition group"
              >
                {a.category && (
                  <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wide">{a.category}</span>
                )}
                <h3 className="text-base font-semibold text-gray-900 mt-1 group-hover:text-indigo-600 transition">
                  {a.title}
                </h3>
                <p className="text-xs text-gray-400 mt-2">{a.views} views · {new Date(a.created_at).toLocaleDateString()}</p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create `frontend/app/help/[slug]/page.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/config";

export default function ArticlePage() {
  const { slug } = useParams();
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`${API_URL}/kb/public/articles/${slug}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then(data => { if (data) setArticle(data); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-700">Article not found</h1>
        <a href="/help" className="text-indigo-600 hover:underline mt-4 block">← Back to Help Center</a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <a href="/help" className="text-sm text-gray-500 hover:text-gray-700">← Help Center</a>
        {article?.category && (
          <span className="text-sm text-indigo-500 font-medium">{article.category}</span>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{article?.title}</h1>
        <p className="text-sm text-gray-400 mb-8">
          {article?.views} views · Updated {article?.updated_at
            ? new Date(article.updated_at).toLocaleDateString()
            : new Date(article?.created_at).toLocaleDateString()}
        </p>
        <div
          className="prose prose-gray max-w-none"
          dangerouslySetInnerHTML={{ __html: article?.content_html || "" }}
        />
      </div>
    </div>
  );
}
```

**Step 3: Verify in browser**

1. Create an article at `/admin/kb/new` → publish it
2. Navigate to `/help` — article appears in the grid
3. Search for keywords — filters correctly
4. Click article → article detail page with HTML content rendered
5. View count increments on each visit

**Step 4: Commit**

```bash
git add frontend/app/help/
git commit -m "feat: add public Help Center portal with search, category filter, and article view"
```

---

### Task 8: Bot fallback to KB articles

**Files:**
- Modify: `backend/app/services/bot_service.py`

**Step 1: Read bot_service.py**

Read `backend/app/services/bot_service.py` to find where the bot returns a response when no Q&A pair matches. Look for a function like `get_bot_response` or the final fallback return.

**Step 2: Add KB fallback**

Find the section that handles no matching Q&A (likely returns a generic "I don't know" message). Before that return, add:

```python
# KB article fallback — search published articles for relevant content
from app.models.kb import KBArticle
from sqlalchemy import or_
kb_results = db.query(KBArticle).filter(
    KBArticle.published == True,
    or_(
        KBArticle.title.ilike(f"%{user_message}%"),
        KBArticle.content_html.ilike(f"%{user_message}%"),
    )
).limit(2).all()

if kb_results:
    base_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    links = "\n".join([f"• [{a.title}]({base_url}/help/{a.slug})" for a in kb_results])
    return f"I found some relevant help articles:\n{links}"
```

**Note:** The exact integration point depends on the existing bot_service.py structure. Read the file first and find the appropriate fallback location. Do not change any existing Q&A matching logic.

**Step 3: Verify**

1. Open a chat widget conversation
2. Send a message that matches a published KB article title
3. Bot should respond with a link to the relevant article instead of the generic fallback

**Step 4: Commit**

```bash
git add backend/app/services/bot_service.py
git commit -m "feat: add KB article fallback in bot service when no Q&A pair matches"
```
