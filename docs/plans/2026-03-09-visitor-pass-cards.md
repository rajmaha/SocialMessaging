# Visitor Pass Card Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admins to define a pool of physical pass cards per location; receptionists pick an available card at check-in; the card is freed automatically on checkout.

**Architecture:** New `visitor_pass_cards` table (id, location_id, card_no, is_active) scoped per location. `visits.pass_card_id` FK references it. A card is "in use" when an active visit (`check_out_at IS NULL`) references it — no separate status column. Four new API endpoints manage the pool. Check-in form gets a dynamic dropdown filtered to available cards for the selected location.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (Python), Next.js 14 App Router (TypeScript), PostgreSQL, TailwindCSS

---

### Task 1: Add `VisitorPassCard` model and DB migration

**Files:**
- Modify: `backend/app/models/visitors.py`
- Modify: `backend/main.py` — add inline SQL migrations

**Step 1: Add `VisitorPassCard` ORM model to `backend/app/models/visitors.py`**

Add after the `VisitorLocation` class:

```python
class VisitorPassCard(Base):
    __tablename__ = "visitor_pass_cards"

    id          = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("visitor_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    card_no     = Column(String, nullable=False)
    is_active   = Column(Boolean, nullable=False, default=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
```

**Step 2: Add `pass_card_id` column to the `Visit` model**

In the `Visit` class, add after `cctv_photo_path`:

```python
pass_card_id = Column(Integer, ForeignKey("visitor_pass_cards.id", ondelete="SET NULL"), nullable=True)
```

**Step 3: Add inline SQL migrations to `backend/main.py`**

Find the `_run_inline_migrations()` function. Inside it, add these two migration blocks using the existing `text()` + `IF NOT EXISTS` pattern used elsewhere in that function:

```python
# visitor_pass_cards table
with engine.connect() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS visitor_pass_cards (
            id          SERIAL PRIMARY KEY,
            location_id INTEGER NOT NULL REFERENCES visitor_locations(id) ON DELETE CASCADE,
            card_no     VARCHAR NOT NULL,
            is_active   BOOLEAN NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (location_id, card_no)
        )
    """))
    conn.commit()

# Add pass_card_id to visits
with engine.connect() as conn:
    conn.execute(text("""
        ALTER TABLE visits
            ADD COLUMN IF NOT EXISTS pass_card_id INTEGER
            REFERENCES visitor_pass_cards(id) ON DELETE SET NULL
    """))
    conn.commit()
```

**Step 4: Verify backend starts without errors**

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Expected: Server starts, no migration errors in logs. Check `/docs` loads at http://localhost:8000/docs.

**Step 5: Commit**

```bash
git add backend/app/models/visitors.py backend/main.py
git commit -m "feat: add VisitorPassCard model and DB migration"
```

---

### Task 2: Add Pydantic schemas for pass cards

**Files:**
- Modify: `backend/app/schemas/visitors.py`

**Step 1: Add `PassCardCreate` and `PassCardOut` schemas**

Add after the `VisitorLocationOut` class:

```python
# ── Pass Cards ────────────────────────────────────────────────────────────────

class PassCardCreate(BaseModel):
    location_id: int
    card_no: str


class PassCardOut(BaseModel):
    id: int
    location_id: int
    card_no: str
    is_active: bool
    in_use: bool = False          # True if an active visit holds this card
    held_by: Optional[str] = None # visitor name if in_use

    class Config:
        from_attributes = True
```

**Step 2: Extend `VisitCreate` with `pass_card_id`**

Add to the `VisitCreate` class:

```python
pass_card_id: Optional[int] = None
```

**Step 3: Extend `VisitOut` with pass card fields**

Add to the `VisitOut` class:

```python
pass_card_id: Optional[int] = None
pass_card_no: Optional[str] = None   # denormalised for display
```

**Step 4: Commit**

```bash
git add backend/app/schemas/visitors.py
git commit -m "feat: add PassCard schemas and extend Visit schemas"
```

---

### Task 3: Add pass-card API endpoints

**Files:**
- Modify: `backend/app/routes/visitors.py`

**Step 1: Import `VisitorPassCard` and `PassCardCreate`/`PassCardOut` at the top of the routes file**

Find the existing imports block:
```python
from app.models.visitors import Visit, VisitorLocation, VisitorProfile
from app.schemas.visitors import (
    VisitCreate, VisitOut,
    VisitorLocationCreate, VisitorLocationOut, VisitorLocationUpdate,
    VisitorProfileOut,
)
```

Add `VisitorPassCard` to the models import and `PassCardCreate, PassCardOut` to the schemas import.

**Step 2: Add four new endpoints after the `camera_stream_ready` endpoint**

Add these endpoints in the following order:

```python
# ── Pass Cards ────────────────────────────────────────────────────────────────

@router.get("/pass-cards", response_model=List[PassCardOut])
def list_pass_cards(
    location_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """List all pass cards, optionally filtered by location. Includes in_use status."""
    q = db.query(VisitorPassCard)
    if location_id:
        q = q.filter(VisitorPassCard.location_id == location_id)
    cards = q.order_by(VisitorPassCard.location_id, VisitorPassCard.card_no).all()

    result = []
    for card in cards:
        active_visit = (
            db.query(Visit)
            .filter(Visit.pass_card_id == card.id, Visit.check_out_at.is_(None))
            .first()
        )
        in_use = active_visit is not None
        held_by = None
        if in_use and active_visit:
            profile = db.query(VisitorProfile).filter(
                VisitorProfile.id == active_visit.visitor_profile_id
            ).first()
            held_by = profile.name if profile else None
        result.append(PassCardOut(
            id=card.id,
            location_id=card.location_id,
            card_no=card.card_no,
            is_active=card.is_active,
            in_use=in_use,
            held_by=held_by,
        ))
    return result


@router.post("/pass-cards", response_model=PassCardOut)
def create_pass_card(
    payload: PassCardCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Create a new pass card for a location. card_no must be unique within the location."""
    # Verify location exists
    loc = db.query(VisitorLocation).filter(VisitorLocation.id == payload.location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    # Check uniqueness
    existing = db.query(VisitorPassCard).filter(
        VisitorPassCard.location_id == payload.location_id,
        VisitorPassCard.card_no == payload.card_no,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Card number already exists for this location")

    card = VisitorPassCard(location_id=payload.location_id, card_no=payload.card_no)
    db.add(card)
    db.commit()
    db.refresh(card)
    return PassCardOut(id=card.id, location_id=card.location_id, card_no=card.card_no,
                       is_active=card.is_active, in_use=False)


@router.delete("/pass-cards/{card_id}")
def delete_pass_card(
    card_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Delete a pass card. Blocked if card is currently assigned to an active visit."""
    card = db.query(VisitorPassCard).filter(VisitorPassCard.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Pass card not found")

    active = db.query(Visit).filter(
        Visit.pass_card_id == card_id,
        Visit.check_out_at.is_(None),
    ).first()
    if active:
        raise HTTPException(status_code=409, detail="Cannot delete a card that is currently in use")

    db.delete(card)
    db.commit()
    return {"ok": True}


@router.get("/pass-cards/available", response_model=List[PassCardOut])
def available_pass_cards(
    location_id: int,
    db: Session = Depends(get_db),
):
    """Return active pass cards not currently held by any checked-in visitor.
    No auth required — used by the check-in form.
    """
    cards = db.query(VisitorPassCard).filter(
        VisitorPassCard.location_id == location_id,
        VisitorPassCard.is_active.is_(True),
    ).order_by(VisitorPassCard.card_no).all()

    result = []
    for card in cards:
        in_use = db.query(Visit).filter(
            Visit.pass_card_id == card.id,
            Visit.check_out_at.is_(None),
        ).first() is not None
        if not in_use:
            result.append(PassCardOut(
                id=card.id, location_id=card.location_id, card_no=card.card_no,
                is_active=card.is_active, in_use=False,
            ))
    return result
```

**Important:** The `/pass-cards/available` route MUST be placed BEFORE `/pass-cards/{card_id}` in the file — FastAPI matches routes in order and `available` would otherwise be treated as a `card_id` value.

**Step 3: Verify endpoints appear in Swagger**

Open http://localhost:8000/docs and confirm these four endpoints exist under the visitors section:
- `GET /visitors/pass-cards`
- `POST /visitors/pass-cards`
- `DELETE /visitors/pass-cards/{card_id}`
- `GET /visitors/pass-cards/available`

**Step 4: Commit**

```bash
git add backend/app/routes/visitors.py
git commit -m "feat: add pass-card CRUD and available-cards endpoints"
```

---

### Task 4: Update `create_visit` and `_visit_out` for pass card

**Files:**
- Modify: `backend/app/routes/visitors.py`

**Step 1: Update `_visit_out` to include `pass_card_no`**

Find the `_visit_out` function. It currently builds a `VisitOut(...)` call. Add `pass_card_no` to the return value:

```python
# Add this lookup before the return statement in _visit_out:
pass_card_no: Optional[str] = None
if visit.pass_card_id:
    card = db.query(VisitorPassCard).filter(VisitorPassCard.id == visit.pass_card_id).first()
    pass_card_no = card.card_no if card else None
```

Then add to the `VisitOut(...)` constructor call:
```python
pass_card_id=visit.pass_card_id,
pass_card_no=pass_card_no,
```

**Step 2: Update `create_visit` to validate and assign `pass_card_id`**

Inside `create_visit`, after the profile create/update block and BEFORE creating the `Visit` object, add pass card validation:

```python
# Validate pass card if provided
if payload.pass_card_id:
    card = db.query(VisitorPassCard).filter(VisitorPassCard.id == payload.pass_card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Pass card not found")
    # Card must belong to the visit's location
    if payload.location_id and card.location_id != payload.location_id:
        raise HTTPException(status_code=400, detail="Pass card does not belong to the selected location")
    # Card must not be in use
    active = db.query(Visit).filter(
        Visit.pass_card_id == payload.pass_card_id,
        Visit.check_out_at.is_(None),
    ).first()
    if active:
        raise HTTPException(status_code=409, detail="Pass card is already in use")
```

Then add `pass_card_id=payload.pass_card_id` to the `Visit(...)` constructor call.

**Step 3: Verify via Swagger**

- Create a test pass card via `POST /visitors/pass-cards`
- Check in a visitor using that card via `POST /visitors/`
- Try checking in again with the same card — expect HTTP 409
- Check out the first visitor via `PATCH /visitors/{id}/checkout`
- Try checking in again with the same card — expect success

**Step 4: Commit**

```bash
git add backend/app/routes/visitors.py
git commit -m "feat: assign and validate pass card on visit check-in"
```

---

### Task 5: Admin UI — Pass Cards panel in Locations page

**Files:**
- Modify: `frontend/app/admin/visitors/locations/page.tsx`

**Step 1: Add `PassCard` interface and state to the component**

Add at the top of the file (after existing interfaces):

```typescript
interface PassCard {
  id: number
  card_no: string
  is_active: boolean
  in_use: boolean
  held_by?: string
}
```

Add state variables inside the component (after existing state):

```typescript
const [expandedLocId, setExpandedLocId] = useState<number | null>(null)
const [passCards, setPassCards] = useState<PassCard[]>([])
const [loadingCards, setLoadingCards] = useState(false)
const [newCardNo, setNewCardNo] = useState('')
const [addingCard, setAddingCard] = useState(false)
```

**Step 2: Add `loadCards` function**

```typescript
const loadCards = (locId: number) => {
  setLoadingCards(true)
  api.get(`/visitors/pass-cards?location_id=${locId}`)
    .then(r => setPassCards(r.data))
    .finally(() => setLoadingCards(false))
}
```

**Step 3: Add `toggleCards` function**

```typescript
const toggleCards = (locId: number) => {
  if (expandedLocId === locId) {
    setExpandedLocId(null)
    setPassCards([])
  } else {
    setExpandedLocId(locId)
    loadCards(locId)
  }
}
```

**Step 4: Add `handleAddCard` and `handleDeleteCard` functions**

```typescript
const handleAddCard = async (locId: number) => {
  if (!newCardNo.trim()) return
  setAddingCard(true)
  try {
    await api.post('/visitors/pass-cards', { location_id: locId, card_no: newCardNo.trim() })
    setNewCardNo('')
    loadCards(locId)
  } catch (e: any) {
    alert(e?.response?.data?.detail || 'Failed to add card')
  } finally {
    setAddingCard(false)
  }
}

const handleDeleteCard = async (cardId: number, locId: number) => {
  if (!confirm('Delete this pass card?')) return
  try {
    await api.delete(`/visitors/pass-cards/${cardId}`)
    loadCards(locId)
  } catch (e: any) {
    alert(e?.response?.data?.detail || 'Cannot delete: card may be in use')
  }
}
```

**Step 5: Add the Pass Cards panel to each location row**

Replace the existing location card JSX (the `<div key={loc.id} className="bg-white rounded-xl border p-4 flex items-center justify-between">` block) with:

```tsx
<div key={loc.id} className="bg-white rounded-xl border overflow-hidden">
  {/* Location row */}
  <div className="p-4 flex items-center justify-between">
    <div>
      <p className="font-medium text-gray-800">{loc.name}</p>
      <p className="text-xs text-gray-400 mt-0.5">
        {loc.ip_camera_url ? `📷 ${loc.ip_camera_url}` : 'No IP camera configured'}
      </p>
    </div>
    <div className="flex items-center gap-2">
      {loc.ip_camera_url && (
        <>
          <Link
            href={`/admin/visitors/cameras?loc=${loc.id}`}
            className="text-xs text-red-600 hover:underline font-medium">
            📹 Live View
          </Link>
          <button onClick={() => testSnapshot(loc.id)}
            className="text-xs text-blue-600 hover:underline">Snapshot</button>
        </>
      )}
      <button
        onClick={() => toggleCards(loc.id)}
        className="text-xs text-gray-500 hover:text-blue-600 border rounded px-2 py-0.5">
        🪪 Pass Cards
      </button>
      <button onClick={() => openEdit(loc)}
        className="text-xs text-gray-500 hover:text-gray-700">Edit</button>
      <button onClick={() => handleDelete(loc.id)}
        className="text-xs text-red-500 hover:text-red-700">Delete</button>
    </div>
  </div>

  {/* Pass Cards panel */}
  {expandedLocId === loc.id && (
    <div className="border-t bg-gray-50 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Pass Cards</p>

      {loadingCards ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-2 mb-3">
          {passCards.length === 0 && (
            <p className="text-xs text-gray-400">No cards configured yet.</p>
          )}
          {passCards.map(card => (
            <div key={card.id} className="flex items-center justify-between bg-white border rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${card.in_use ? 'bg-red-500' : 'bg-green-500'}`} />
                <span className="text-sm font-medium text-gray-800">Card #{card.card_no}</span>
                {card.in_use && card.held_by && (
                  <span className="text-xs text-gray-400">— {card.held_by}</span>
                )}
              </div>
              <button
                onClick={() => handleDeleteCard(card.id, loc.id)}
                disabled={card.in_use}
                title={card.in_use ? 'Card is in use — cannot delete' : 'Delete card'}
                className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add card form */}
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
          placeholder="Card number (e.g. 5 or A-05)"
          value={newCardNo}
          onChange={e => setNewCardNo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddCard(loc.id)}
        />
        <button
          onClick={() => handleAddCard(loc.id)}
          disabled={addingCard || !newCardNo.trim()}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {addingCard ? 'Adding…' : '+ Add'}
        </button>
      </div>
    </div>
  )}
</div>
```

**Step 6: Verify in browser**

Navigate to `/admin/visitors/locations`. Click "🪪 Pass Cards" on any location. Panel should expand showing an empty list and an add form. Add a card, verify it appears. Try deleting it.

**Step 7: Commit**

```bash
git add frontend/app/admin/visitors/locations/page.tsx
git commit -m "feat: add per-location pass card management panel"
```

---

### Task 6: Check-in form — Pass Card dropdown

**Files:**
- Modify: `frontend/app/admin/visitors/new/page.tsx`

**Step 1: Add `PassCard` interface and state**

Add interface after existing interfaces:

```typescript
interface PassCard { id: number; card_no: string }
```

Add state (after the `form` state):

```typescript
const [availableCards, setAvailableCards] = useState<PassCard[]>([])
const [passCardId, setPassCardId] = useState<string>('')
```

**Step 2: Load available cards when location changes**

Find the existing `useEffect` that calls `stopCctvPlayer()` when `form.location_id` changes. Add card loading to it:

```typescript
// After stopCctvPlayer() and before the CCTV stream logic, add:
setPassCardId('')
setAvailableCards([])
if (e /* it's actually form.location_id */ ) {
  // already in the effect body
}
```

Actually — add a separate `useEffect` that watches `form.location_id`:

```typescript
useEffect(() => {
  setPassCardId('')
  setAvailableCards([])
  if (!form.location_id) return
  api.get(`/visitors/pass-cards/available?location_id=${form.location_id}`)
    .then(r => setAvailableCards(r.data))
    .catch(() => {})
}, [form.location_id])
```

**Step 3: Add pass card to `handleSubmit`**

In `handleSubmit`, add `pass_card_id` to the API call payload:

```typescript
await api.post('/visitors/', {
  ...form,
  num_visitors: parseInt(form.num_visitors),
  host_agent_id: form.host_agent_id ? parseInt(form.host_agent_id) : null,
  location_id: form.location_id ? parseInt(form.location_id) : null,
  visitor_photo_path: photoPath,
  pass_card_id: passCardId ? parseInt(passCardId) : null,
})
```

**Step 4: Add Pass Card dropdown to the form JSX**

Find the Location `<select>` block inside the Visit Details section:

```tsx
<div className="col-span-2">
  <label className="block text-xs text-gray-500 mb-1">Location</label>
  <select ...>
```

Add the Pass Card dropdown immediately AFTER it (still inside the `grid grid-cols-2 gap-4` div):

```tsx
{availableCards.length > 0 && (
  <div className="col-span-2">
    <label className="block text-xs text-gray-500 mb-1">Pass Card</label>
    <select
      className="w-full border rounded-lg px-3 py-2 text-sm"
      value={passCardId}
      onChange={e => setPassCardId(e.target.value)}>
      <option value="">— No card —</option>
      {availableCards.map(c => (
        <option key={c.id} value={c.id}>Card #{c.card_no}</option>
      ))}
    </select>
  </div>
)}
```

**Step 5: Verify in browser**

- Go to `/admin/visitors/new`
- Select a location that has pass cards configured
- Pass Card dropdown should appear showing available cards
- Change location — dropdown should reset and reload
- Submit the form — check the visit detail page shows the assigned card

**Step 6: Commit**

```bash
git add frontend/app/admin/visitors/new/page.tsx
git commit -m "feat: add pass card dropdown to check-in form"
```

---

### Task 7: Visit detail page — show Pass Card

**Files:**
- Modify: `frontend/app/admin/visitors/[id]/page.tsx`

**Step 1: Add `pass_card_no` to the `Visit` interface**

Find:
```typescript
interface Visit {
  ...
  status: string
}
```

Add:
```typescript
pass_card_no?: string
```

**Step 2: Add Pass Card row to the details panel**

Find the details array:
```typescript
['Purpose', visit.purpose],
['Host', visit.host_agent_name || '—'],
['Location', visit.location_name || '—'],
['Group Size', String(visit.num_visitors)],
['Status', ...],
['Checked In', ...],
['Checked Out', ...],
```

Add after `['Location', ...]`:

```typescript
['Pass Card', visit.pass_card_no ? `Card #${visit.pass_card_no}` : '—'],
```

**Step 3: Verify in browser**

Open a visit that has a pass card assigned. The "Visit Details" card should show a "Pass Card" row with the card number.

**Step 4: Commit**

```bash
git add frontend/app/admin/visitors/\[id\]/page.tsx
git commit -m "feat: show pass card number in visit detail page"
```

---

### Task 8: Build verification

**Step 1: Run frontend build**

```bash
cd /Users/rajmaha/Sites/SocialMedia/frontend && npm run build 2>&1 | tail -20
```

Expected: Build completes with no TypeScript errors. Warnings about `console.log` are fine.

**Step 2: Fix any build errors in the three modified frontend files, commit if needed**

```bash
git add frontend/app/admin/visitors/locations/page.tsx \
        frontend/app/admin/visitors/new/page.tsx \
        "frontend/app/admin/visitors/[id]/page.tsx"
git commit -m "fix: resolve build issues from pass card feature"
```
