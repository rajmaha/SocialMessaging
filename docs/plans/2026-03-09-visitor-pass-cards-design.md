# Visitor Pass Card Management — Design

**Date:** 2026-03-09
**Status:** Approved

## Problem

Physical pass cards are handed to visitors at check-in and returned at checkout for reuse. There is currently no way to record which card was given to which visitor, or to know which cards are available at any point.

## Approach: Managed Per-Location Card Pool

Cards are pre-defined by admins per location (each location has its own set of numbered cards). A card is "in use" while an active visit references it. On checkout the card is automatically freed. The check-in form shows only available cards for the selected location.

---

## Database

### New table: `visitor_pass_cards`

```sql
CREATE TABLE IF NOT EXISTS visitor_pass_cards (
    id          SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES visitor_locations(id) ON DELETE CASCADE,
    card_no     VARCHAR NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (location_id, card_no)
);
```

- `card_no` is a free-text label matching whatever is printed on the physical card (e.g. `"5"`, `"A-05"`)
- `is_active` lets admins soft-deactivate lost/damaged cards without deleting history
- `UNIQUE (location_id, card_no)` prevents duplicate card numbers within the same location

### Modified table: `visits`

```sql
ALTER TABLE visits
    ADD COLUMN IF NOT EXISTS pass_card_id INTEGER REFERENCES visitor_pass_cards(id) ON DELETE SET NULL;
```

**Card availability rule:** a card is in use when there exists an active visit (`check_out_at IS NULL`) with `pass_card_id = card.id`. No separate status column — visits are the source of truth.

---

## Backend

### New model: `VisitorPassCard` (`backend/app/models/visitors.py`)

```python
class VisitorPassCard(Base):
    __tablename__ = "visitor_pass_cards"
    id          = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("visitor_locations.id", ondelete="CASCADE"), nullable=False)
    card_no     = Column(String, nullable=False)
    is_active   = Column(Boolean, nullable=False, default=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
```

### Modified model: `Visit`

Add column:
```python
pass_card_id = Column(Integer, ForeignKey("visitor_pass_cards.id", ondelete="SET NULL"), nullable=True)
```

### New Pydantic schemas (`backend/app/schemas/visitors.py`)

```python
class PassCardCreate(BaseModel):
    location_id: int
    card_no: str

class PassCardOut(BaseModel):
    id: int
    location_id: int
    card_no: str
    is_active: bool
    in_use: bool          # derived: True if active visit holds this card
    held_by: Optional[str]  # visitor name if in_use

    class Config:
        from_attributes = True
```

`VisitCreate` gains:
```python
pass_card_id: Optional[int] = None
```

`VisitOut` gains:
```python
pass_card_id: Optional[int] = None
pass_card_no: Optional[str] = None   # denormalised for display
```

### New API endpoints (`backend/app/routes/visitors.py`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/visitors/pass-cards` | admin | List all cards; filter by `?location_id=X` |
| `POST` | `/visitors/pass-cards` | admin | Create a card `{location_id, card_no}` |
| `DELETE` | `/visitors/pass-cards/{id}` | admin | Delete card (blocked if in use) |
| `GET` | `/visitors/pass-cards/available` | any | Cards not on active visit; filter by `?location_id=X` |

### Modified endpoints

- `POST /visitors` (create visit) — if `pass_card_id` provided: validate card belongs to visit's location AND is not currently in use → HTTP 409 if violated
- `GET /visitors/{id}` — include `pass_card_no` in response
- `PATCH /visitors/{id}/checkout` — no change needed; card freed automatically when `check_out_at` is set

### DB migration (`backend/main.py`)

Added inline using `text()` + `IF NOT EXISTS` pattern:
```python
# visitor_pass_cards table
# ALTER TABLE visits ADD COLUMN pass_card_id
```

---

## Frontend

### Admin: Pass Cards management page

**Route:** `/admin/visitors/locations` (extend existing Locations page with a "Pass Cards" expandable panel per location)

Per-location panel shows:
- List of cards: `Card #5 — 🟢 Available` / `🔴 In Use — John Smith`
- Add card: text input + "Add" button
- Delete button (disabled + tooltip if in use)

### Check-in form (`/admin/visitors/new`)

New field after Location selector:
- Label: **Pass Card**
- Control: dropdown — loads from `GET /visitors/pass-cards/available?location_id=X` when location is selected
- Options: `Card #1`, `Card #3`, `Card #7` … (only available cards)
- Optional — can leave unselected
- Clears/reloads when location changes

### Visit detail page (`/admin/visitors/[id]`)

Add **Pass Card** row to the "Visit Details" panel:
```
Pass Card    |    Card #5
```
Shown as `—` if no card was assigned.

---

## Files Changed

| File | Change |
|---|---|
| `backend/app/models/visitors.py` | Add `VisitorPassCard` model; add `pass_card_id` to `Visit` |
| `backend/app/schemas/visitors.py` | Add `PassCardCreate`, `PassCardOut`; extend `VisitCreate` / `VisitOut` |
| `backend/app/routes/visitors.py` | Add 4 new endpoints; update create-visit and get-visit |
| `backend/main.py` | Inline SQL migration for new table + new column |
| `frontend/app/admin/visitors/locations/page.tsx` | Add per-location pass card management panel |
| `frontend/app/admin/visitors/new/page.tsx` | Add Pass Card dropdown to check-in form |
| `frontend/app/admin/visitors/[id]/page.tsx` | Show Pass Card row in visit details |
