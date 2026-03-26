# Post-Create Form Submission Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a subscription is successfully deployed and created, automatically submit a configured dynamic form to a remote API using a field mapping.

**Architecture:** A new `subscription_settings` single-row config table stores the form slug and field mapping. The deploy-and-create SSE endpoint reads these settings after subscription creation and calls the form's `api_create_method` via `api_request()`. The settings are configured in a new UI section on the Subscription Modules admin page.

**Tech Stack:** FastAPI, SQLAlchemy, Next.js 14, TailwindCSS, Axios

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/app/models/organization.py` | Modify | Add `SubscriptionSettings` model |
| `backend/app/schemas/organization.py` | Modify | Add settings schemas |
| `backend/app/routes/organizations.py` | Modify | Add settings GET/PUT routes + post-create logic in deploy-and-create |
| `backend/main.py` | Modify | Add CREATE TABLE + ALTER TABLE migration |
| `frontend/app/admin/subscription-modules/page.tsx` | Modify | Add settings section UI |
| `frontend/lib/api.ts` | Modify | Add settings API methods |

---

## Task 1: Backend — SubscriptionSettings Model & Migration

**Files:**
- Modify: `backend/app/models/organization.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Add SubscriptionSettings model**

In `backend/app/models/organization.py`, add after the `SubscriptionModule` class:

```python
class SubscriptionSettings(Base):
    __tablename__ = "subscription_settings"

    id = Column(Integer, primary_key=True, index=True)
    post_create_form_slug = Column(String, nullable=True)
    post_create_field_map = Column(JSON, nullable=True)  # [{"form_key": "x", "source_key": "subscription.y"}]
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 2: Add database migration in main.py**

Find the section with other `CREATE TABLE IF NOT EXISTS` statements and add:

```python
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS subscription_settings (
        id INTEGER PRIMARY KEY,
        post_create_form_slug VARCHAR,
        post_create_field_map JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""))
```

- [ ] **Step 3: Verify backend starts without errors**

Run: restart uvicorn and check logs for migration errors.

---

## Task 2: Backend — Settings Schemas

**Files:**
- Modify: `backend/app/schemas/organization.py`

- [ ] **Step 1: Add settings schemas**

Add at end of file:

```python
class SubscriptionSettingsUpdate(BaseModel):
    post_create_form_slug: Optional[str] = None
    post_create_field_map: Optional[List[dict]] = None  # [{"form_key": "x", "source_key": "subscription.y"}]

class SubscriptionSettingsResponse(BaseModel):
    id: int
    post_create_form_slug: Optional[str] = None
    post_create_field_map: Optional[List[dict]] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)
```

---

## Task 3: Backend — Settings GET/PUT Routes

**Files:**
- Modify: `backend/app/routes/organizations.py`

- [ ] **Step 1: Add import for SubscriptionSettings**

In the imports at top, add `SubscriptionSettings` to the model import and add schemas:

```python
from app.models.organization import Organization, OrganizationContact, Subscription, SubscriptionModule, SubscriptionSettings
from app.schemas.organization import (
    ...,
    SubscriptionSettingsUpdate, SubscriptionSettingsResponse,
)
```

- [ ] **Step 2: Add GET /organizations/subscription-settings route**

Add after the subscription module CRUD routes (before the org CRUD routes):

```python
@router.get("/subscription-settings", response_model=SubscriptionSettingsResponse)
def get_subscription_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_subs),
):
    settings = db.query(SubscriptionSettings).first()
    if not settings:
        settings = SubscriptionSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.put("/subscription-settings", response_model=SubscriptionSettingsResponse)
def update_subscription_settings(
    data: SubscriptionSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_subs),
):
    settings = db.query(SubscriptionSettings).first()
    if not settings:
        settings = SubscriptionSettings(id=1)
        db.add(settings)
        db.commit()
    update_data = data.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(settings, key, val)
    db.commit()
    db.refresh(settings)
    return settings
```

- [ ] **Step 3: Verify routes work via Swagger**

Test `GET /organizations/subscription-settings` returns empty settings.
Test `PUT /organizations/subscription-settings` with body `{"post_create_form_slug": "test"}` saves.

---

## Task 4: Backend — Auto-submit Form After Subscription Creation

**Files:**
- Modify: `backend/app/routes/organizations.py`

- [ ] **Step 1: Add form-related imports**

Add to imports in organizations.py:

```python
from app.models.form import Form, FormField
from app.models.api_server import ApiServer, UserApiCredential
from app.services.api_proxy import api_request, api_login
```

- [ ] **Step 2: Add helper function to build form payload from field map**

Add before the deploy-and-create route:

```python
def _build_form_payload(field_map: list, subscription: Subscription, organization: Organization) -> dict:
    """Build form submission data from field mapping config."""
    sources = {}
    # Subscription fields
    for col in subscription.__table__.columns:
        val = getattr(subscription, col.name)
        # Convert dates to strings
        if hasattr(val, 'isoformat'):
            val = val.isoformat()
        sources[f"subscription.{col.name}"] = val
    # Organization fields
    for col in organization.__table__.columns:
        val = getattr(organization, col.name)
        if hasattr(val, 'isoformat'):
            val = val.isoformat()
        sources[f"organization.{col.name}"] = val

    payload = {}
    for mapping in field_map:
        form_key = mapping.get("form_key")
        source_key = mapping.get("source_key")
        if form_key and source_key:
            payload[form_key] = sources.get(source_key)
    return payload
```

- [ ] **Step 3: Add post-create form submission in deploy-and-create SSE generator**

In the `event_generator()` inside `deploy_and_create_subscription`, after the line:
```python
yield f"data: {json.dumps({'step': 'subscription_created', ...})}\n\n"
```

Add:

```python
# Auto-submit post-create form if configured
try:
    settings = db.query(SubscriptionSettings).first()
    if settings and settings.post_create_form_slug and settings.post_create_field_map:
        form_obj = db.query(Form).filter(
            Form.slug == settings.post_create_form_slug,
            Form.is_published == True,
        ).first()
        if form_obj and form_obj.api_create_method and form_obj.api_server_id:
            org = db.query(Organization).filter(Organization.id == org_id).first()
            form_data = _build_form_payload(settings.post_create_field_map, db_sub, org)

            # Inject hidden fields
            from app.routes.forms import _inject_hidden_fields
            form_data = _inject_hidden_fields(db, form_obj, form_data, current_user)

            server = db.query(ApiServer).filter(ApiServer.id == form_obj.api_server_id).first()
            cred = db.query(UserApiCredential).filter(
                UserApiCredential.user_id == current_user.id,
                UserApiCredential.api_server_id == server.id,
            ).first()
            if server and cred:
                import asyncio
                loop = asyncio.get_event_loop()
                result = loop.run_until_complete(
                    api_request(db, server, cred, form_obj.api_create_method, body=form_data)
                )
                yield f"data: {json.dumps({'step': 'form_submitted', 'status': 'success', 'message': 'Form submitted to remote API'})}\n\n"
except Exception as form_err:
    import logging
    logging.getLogger(__name__).warning(f"Post-create form submission failed: {form_err}")
    yield f"data: {json.dumps({'step': 'form_submit_failed', 'status': 'warning', 'message': str(form_err)})}\n\n"
```

**Note:** Since `event_generator()` is a sync generator but `api_request` is async, we need to handle this. Check if the generator is already async (uses `async def`). If it's sync, use `asyncio` to run the coroutine. If the deploy route is already `async`, the generator can be made async too.

- [ ] **Step 4: Verify the deploy-and-create still works without settings configured**

Test creating a subscription with no post-create form configured — should work as before.

---

## Task 5: Frontend — API Client Methods

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add subscription settings API methods**

Add after `formsApi` block or in an appropriate location:

```typescript
export const subscriptionSettingsApi = {
  get: () => api.get('/organizations/subscription-settings'),
  update: (data: any) => api.put('/organizations/subscription-settings', data),
}
```

---

## Task 6: Frontend — Settings Section on Subscription Modules Page

**Files:**
- Modify: `frontend/app/admin/subscription-modules/page.tsx`

- [ ] **Step 1: Add imports and state**

Add to imports:
```typescript
import { subscriptionSettingsApi, formsApi } from '@/lib/api'
import { ChevronDown, Settings } from 'lucide-react'
```

Add state variables inside the component:
```typescript
const [settingsOpen, setSettingsOpen] = useState(false)
const [forms, setForms] = useState<any[]>([])
const [formFields, setFormFields] = useState<any[]>([])
const [settings, setSettings] = useState<any>({ post_create_form_slug: '', post_create_field_map: [] })
const [savingSettings, setSavingSettings] = useState(false)
const [settingsMessage, setSettingsMessage] = useState('')
```

- [ ] **Step 2: Add data fetching functions**

Add functions:
```typescript
const fetchSettings = async () => {
    try {
        const res = await subscriptionSettingsApi.get()
        setSettings(res.data)
        if (res.data.post_create_form_slug) {
            await loadFormFields(res.data.post_create_form_slug)
        }
    } catch (e) { console.error('Failed to load settings', e) }
}

const fetchForms = async () => {
    try {
        const res = await formsApi.list()
        // Only show published API-type forms
        setForms(res.data.filter((f: any) => f.is_published && f.storage_type === 'api'))
    } catch (e) { console.error('Failed to load forms', e) }
}

const loadFormFields = async (slug: string) => {
    try {
        const allForms = forms.length ? forms : (await formsApi.list()).data
        const form = allForms.find((f: any) => f.slug === slug)
        if (form) {
            const res = await formsApi.listFields(form.id)
            setFormFields(res.data.filter((f: any) => f.is_visible))
        }
    } catch (e) { console.error('Failed to load form fields', e) }
}

const handleFormChange = async (slug: string) => {
    setSettings({ ...settings, post_create_form_slug: slug, post_create_field_map: [] })
    setFormFields([])
    if (slug) await loadFormFields(slug)
}

const handleFieldMapChange = (formKey: string, sourceKey: string) => {
    const map = [...(settings.post_create_field_map || [])]
    const idx = map.findIndex((m: any) => m.form_key === formKey)
    if (idx >= 0) {
        map[idx].source_key = sourceKey
    } else {
        map.push({ form_key: formKey, source_key: sourceKey })
    }
    setSettings({ ...settings, post_create_field_map: map })
}

const handleSaveSettings = async () => {
    setSavingSettings(true)
    setSettingsMessage('')
    try {
        await subscriptionSettingsApi.update({
            post_create_form_slug: settings.post_create_form_slug || null,
            post_create_field_map: settings.post_create_field_map || [],
        })
        setSettingsMessage('Settings saved')
        setTimeout(() => setSettingsMessage(''), 3000)
    } catch (e: any) {
        setSettingsMessage('Failed to save settings')
    } finally {
        setSavingSettings(false)
    }
}
```

- [ ] **Step 3: Fetch settings and forms on mount**

Add to the existing `useEffect`:
```typescript
fetchSettings()
fetchForms()
```

- [ ] **Step 4: Add Settings UI section before the modules table**

Insert between the search bar and the modules table:

```tsx
{/* Post-Create Form Settings */}
<div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
    <button
        onClick={() => setSettingsOpen(!settingsOpen)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
    >
        <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-gray-500" />
            <span className="font-semibold text-gray-900 text-sm">Post-Create Form Settings</span>
            {settings.post_create_form_slug && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
            )}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
    </button>

    {settingsOpen && (
        <div className="px-6 pb-5 border-t border-gray-100 pt-4 space-y-4">
            <p className="text-xs text-gray-500">Automatically submit a form to a remote API after a subscription is created.</p>

            <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Form</label>
                <select
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                    value={settings.post_create_form_slug || ''}
                    onChange={(e) => handleFormChange(e.target.value)}
                >
                    <option value="">— None —</option>
                    {forms.map((f: any) => (
                        <option key={f.slug} value={f.slug}>{f.title} ({f.slug})</option>
                    ))}
                </select>
            </div>

            {formFields.length > 0 && (
                <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Field Mapping</label>
                    <div className="space-y-2">
                        {formFields.map((field: any) => {
                            const currentMap = (settings.post_create_field_map || []).find((m: any) => m.form_key === field.field_key)
                            return (
                                <div key={field.field_key} className="flex items-center gap-3">
                                    <span className="text-sm text-gray-700 w-1/3 truncate">{field.field_label}</span>
                                    <span className="text-gray-400">→</span>
                                    <select
                                        className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white"
                                        value={currentMap?.source_key || ''}
                                        onChange={(e) => handleFieldMapChange(field.field_key, e.target.value)}
                                    >
                                        <option value="">— Skip —</option>
                                        <optgroup label="Subscription">
                                            <option value="subscription.subscribed_product">Product</option>
                                            <option value="subscription.system_url">System URL</option>
                                            <option value="subscription.modules">Modules</option>
                                            <option value="subscription.subscribed_on_date">Subscribed On</option>
                                            <option value="subscription.billed_from_date">Billed From</option>
                                            <option value="subscription.expire_date">Expire Date</option>
                                            <option value="subscription.status">Status</option>
                                            <option value="subscription.company_logo_url">Logo URL</option>
                                        </optgroup>
                                        <optgroup label="Organization">
                                            <option value="organization.organization_name">Name</option>
                                            <option value="organization.email">Email</option>
                                            <option value="organization.domain_name">Domain</option>
                                            <option value="organization.pan_no">PAN No</option>
                                            <option value="organization.address">Address</option>
                                            <option value="organization.contact_numbers">Contact Numbers</option>
                                        </optgroup>
                                    </select>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            <div className="flex items-center gap-3 pt-2">
                <button
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                    className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                    {savingSettings ? 'Saving...' : 'Save Settings'}
                </button>
                {settingsMessage && (
                    <span className={`text-sm ${settingsMessage.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
                        {settingsMessage}
                    </span>
                )}
            </div>
        </div>
    )}
</div>
```

- [ ] **Step 5: Commit all changes**

```bash
git add -A
git commit -m "feat: auto-submit form after subscription creation with configurable field mapping"
```
