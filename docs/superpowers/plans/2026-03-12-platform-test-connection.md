# Platform Test Connection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Test Connection" button to the platform configuration form that verifies credentials AND webhook subscription status against each platform's live API.

**Architecture:** A new `POST /admin/platforms/{platform}/test` backend endpoint accepts form credentials, runs a credential probe + webhook check per platform, and returns a structured result. The frontend sends current form values, shows an inline two-row result panel (credential row + webhook row), and clears the result whenever a field changes.

**Tech Stack:** FastAPI + httpx (backend), Next.js / React / TailwindCSS (frontend)

---

## Chunk 1: Backend — test endpoint

### Task 1: Add test_connection methods to platform_service.py

**Files:**
- Modify: `backend/app/services/platform_service.py`

Each method accepts explicit credentials (not env vars) and returns:
```python
{
    "credential_ok": bool,
    "credential_detail": str,
    "webhook_status": str,   # "registered" | "not_registered" | "unknown"
    "webhook_detail": str
}
```

- [ ] **Step 1: Add WhatsApp test_connection**

Add to `backend/app/services/platform_service.py` after the `WhatsAppService` class:

```python
class WhatsAppTestService:
    BASE_URL = "https://graph.facebook.com/v18.0"

    @staticmethod
    async def test_connection(access_token: str, phone_number_id: str) -> dict:
        result = {
            "credential_ok": False,
            "credential_detail": "",
            "webhook_status": "unknown",
            "webhook_detail": ""
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                # 1. Credential probe
                cred_resp = await client.get(
                    f"{WhatsAppTestService.BASE_URL}/{phone_number_id}",
                    params={"access_token": access_token, "fields": "display_phone_number,verified_name"}
                )
                cred_data = cred_resp.json()
                if "error" in cred_data:
                    result["credential_detail"] = cred_data["error"].get("message", "Invalid credentials")
                    return result
                result["credential_ok"] = True
                name = cred_data.get("verified_name") or cred_data.get("display_phone_number", "")
                result["credential_detail"] = f"Connected as: {name}"

                # 2. Webhook check
                hook_resp = await client.get(
                    f"{WhatsAppTestService.BASE_URL}/{phone_number_id}/subscribed_apps",
                    params={"access_token": access_token}
                )
                hook_data = hook_resp.json()
                if "error" in hook_data:
                    result["webhook_status"] = "not_registered"
                    result["webhook_detail"] = hook_data["error"].get("message", "Webhook not registered")
                else:
                    data = hook_data.get("data", [])
                    if data:
                        fields = ", ".join(data[0].get("subscribed_fields", []))
                        result["webhook_status"] = "registered"
                        result["webhook_detail"] = f"Subscribed to: {fields}" if fields else "Webhook registered"
                    else:
                        result["webhook_status"] = "not_registered"
                        result["webhook_detail"] = "No webhook subscription found"
        except Exception as e:
            result["credential_detail"] = f"Connection error: {str(e)}"
        return result
```

- [ ] **Step 2: Add Facebook test_connection**

Add after the `FacebookService` class:

```python
class FacebookTestService:
    BASE_URL = "https://graph.facebook.com/v18.0"

    @staticmethod
    async def test_connection(access_token: str, page_id: str) -> dict:
        result = {
            "credential_ok": False,
            "credential_detail": "",
            "webhook_status": "unknown",
            "webhook_detail": ""
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                # 1. Credential probe
                cred_resp = await client.get(
                    f"{FacebookTestService.BASE_URL}/{page_id}",
                    params={"access_token": access_token, "fields": "name,id"}
                )
                cred_data = cred_resp.json()
                if "error" in cred_data:
                    result["credential_detail"] = cred_data["error"].get("message", "Invalid credentials")
                    return result
                result["credential_ok"] = True
                result["credential_detail"] = f"Connected as: {cred_data.get('name', page_id)}"

                # 2. Webhook check
                hook_resp = await client.get(
                    f"{FacebookTestService.BASE_URL}/{page_id}/subscribed_apps",
                    params={"access_token": access_token}
                )
                hook_data = hook_resp.json()
                if "error" in hook_data:
                    result["webhook_status"] = "not_registered"
                    result["webhook_detail"] = hook_data["error"].get("message", "Webhook not registered")
                else:
                    data = hook_data.get("data", [])
                    if data:
                        fields = ", ".join(data[0].get("subscribed_fields", []))
                        result["webhook_status"] = "registered"
                        result["webhook_detail"] = f"Subscribed to: {fields}" if fields else "Webhook registered"
                    else:
                        result["webhook_status"] = "not_registered"
                        result["webhook_detail"] = "No webhook subscription found"
        except Exception as e:
            result["credential_detail"] = f"Connection error: {str(e)}"
        return result
```

- [ ] **Step 3: Add Viber test_connection**

Add after the `ViberService` class:

```python
class ViberTestService:
    BASE_URL = "https://chatapi.viber.com/pa"

    @staticmethod
    async def test_connection(access_token: str) -> dict:
        result = {
            "credential_ok": False,
            "credential_detail": "",
            "webhook_status": "unknown",
            "webhook_detail": ""
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{ViberTestService.BASE_URL}/get_account_info",
                    headers={"X-Viber-Auth-Token": access_token, "Content-Type": "application/json"},
                    json={}
                )
                data = resp.json()
                status_code = data.get("status", -1)
                if status_code != 0:
                    result["credential_detail"] = data.get("status_message", "Invalid token")
                    return result
                result["credential_ok"] = True
                result["credential_detail"] = f"Connected as: {data.get('name', 'Viber Bot')}"
                webhook = data.get("webhook", "")
                if webhook:
                    result["webhook_status"] = "registered"
                    result["webhook_detail"] = f"Webhook: {webhook}"
                else:
                    result["webhook_status"] = "not_registered"
                    result["webhook_detail"] = "No webhook URL registered"
        except Exception as e:
            result["credential_detail"] = f"Connection error: {str(e)}"
        return result
```

- [ ] **Step 4: Add LinkedIn test_connection**

Add after the `LinkedInService` class:

```python
class LinkedInTestService:
    BASE_URL = "https://api.linkedin.com/v2"

    @staticmethod
    async def test_connection(access_token: str) -> dict:
        result = {
            "credential_ok": False,
            "credential_detail": "",
            "webhook_status": "unknown",
            "webhook_detail": "LinkedIn does not support programmatic webhook status checks"
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{LinkedInTestService.BASE_URL}/me",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                data = resp.json()
                if resp.status_code != 200:
                    msg = data.get("message") or data.get("serviceErrorCode") or "Invalid access token"
                    result["credential_detail"] = str(msg)
                    return result
                result["credential_ok"] = True
                first = data.get("localizedFirstName", "")
                last = data.get("localizedLastName", "")
                result["credential_detail"] = f"Connected as: {first} {last}".strip() or "LinkedIn account"
        except Exception as e:
            result["credential_detail"] = f"Connection error: {str(e)}"
        return result
```

- [ ] **Step 5: Manually verify via Swagger**

Start the backend: `cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8000`
Confirm no import errors in console output.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/platform_service.py
git commit -m "feat: add per-platform test_connection methods to platform_service"
```

---

### Task 2: Add POST /admin/platforms/{platform}/test endpoint

**Files:**
- Modify: `backend/app/routes/admin.py`

- [ ] **Step 1: Add PlatformTestRequest schema**

Add after the `PlatformSettingUpdate` class (around line 394 in `backend/app/routes/admin.py`):

```python
class PlatformTestRequest(BaseModel):
    app_id: str = None
    app_secret: str = None
    access_token: str = None
    verify_token: str = None
    business_account_id: str = None
    phone_number: str = None
    phone_number_id: str = None
    organization_id: str = None
    page_id: str = None
```

- [ ] **Step 2: Add the test endpoint**

Add after the existing `verify_platform_setting` endpoint (after line ~517):

```python
@router.post("/platforms/{platform}/test")
async def test_platform_connection(
    platform: str,
    request: PlatformTestRequest,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db)
):
    """Test platform credentials and webhook connectivity"""
    from app.services.platform_service import (
        WhatsAppTestService, FacebookTestService,
        ViberTestService, LinkedInTestService
    )

    platform = platform.lower()
    valid_platforms = ["facebook", "whatsapp", "viber", "linkedin"]

    if platform not in valid_platforms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Platform must be one of: {', '.join(valid_platforms)}"
        )

    if platform == "whatsapp":
        if not request.access_token or not request.phone_number_id:
            raise HTTPException(status_code=400, detail="access_token and phone_number_id are required")
        result = await WhatsAppTestService.test_connection(request.access_token, request.phone_number_id)

    elif platform == "facebook":
        if not request.access_token or not request.page_id:
            raise HTTPException(status_code=400, detail="access_token and page_id are required")
        result = await FacebookTestService.test_connection(request.access_token, request.page_id)

    elif platform == "viber":
        if not request.access_token:
            raise HTTPException(status_code=400, detail="access_token is required")
        result = await ViberTestService.test_connection(request.access_token)

    elif platform == "linkedin":
        if not request.access_token:
            raise HTTPException(status_code=400, detail="access_token is required")
        result = await LinkedInTestService.test_connection(request.access_token)

    # If credentials passed, mark as verified in DB
    if result.get("credential_ok"):
        setting = db.query(PlatformSettings).filter(
            PlatformSettings.platform == platform
        ).first()
        if setting:
            setting.is_configured = 2
            setting.updated_at = datetime.utcnow()
            db.commit()

    return result
```

- [ ] **Step 3: Manually test via Swagger**

Navigate to `http://localhost:8000/docs` → `POST /admin/platforms/whatsapp/test`
Send a body with a bad token:
```json
{ "access_token": "bad_token", "phone_number_id": "123" }
```
Expected response: `{ "credential_ok": false, "credential_detail": "..." }`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/admin.py
git commit -m "feat: add POST /admin/platforms/{platform}/test endpoint"
```

---

## Chunk 2: Frontend — Test Connection button and result panel

### Task 3: Add test state and handler to AdminSettings

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`

- [ ] **Step 1: Add testResult state**

In the state declarations section (after the `showForm` state, around line 27), add:

```typescript
const [testResult, setTestResult] = useState<{
    credential_ok: boolean;
    credential_detail: string;
    webhook_status: string;
    webhook_detail: string;
} | null>(null);
const [testing, setTesting] = useState(false);
```

- [ ] **Step 2: Clear testResult when any field changes**

In `handleFormChange`, add `setTestResult(null)` as the first line of the function body:

```typescript
const handleFormChange = (platform: string, field: string, value: string) => {
    setTestResult(null);
    const platformKey = platform as keyof typeof formData;
    setFormData((prev) => ({
        ...prev,
        [platformKey]: {
            ...prev[platformKey],
            [field]: value
        }
    }));
};
```

- [ ] **Step 3: Add handleTestConnection function**

Add after `handleFormChange`:

```typescript
const handleTestConnection = async (platform: string) => {
    const token = getAuthToken();
    if (!token) { setError('Not authenticated'); return; }

    setTesting(true);
    setTestResult(null);
    try {
        const platformKey = platform as keyof typeof formData;
        const response = await fetch(`${API_URL}/admin/platforms/${platform}/test`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData[platformKey])
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || 'Test failed');
        }
        const result = await response.json();
        setTestResult(result);
        // Refresh cards if credentials passed (status may have updated to Verified)
        if (result.credential_ok) await fetchPlatforms();
    } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
        setTesting(false);
    }
};
```

- [ ] **Step 4: Add isTestable helper**

Add before the `return` statement:

```typescript
const isTestable = (platform: string): boolean => {
    if (platform === 'whatsapp') {
        return !!(formData.whatsapp.access_token && formData.whatsapp.phone_number_id);
    }
    if (platform === 'facebook') {
        return !!(formData.facebook.access_token && formData.facebook.page_id);
    }
    if (platform === 'viber') return !!formData.viber.access_token;
    if (platform === 'linkedin') return !!formData.linkedin.access_token;
    return false;
};
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/settings/page.tsx
git commit -m "feat: add test connection state, handler, and isTestable helper"
```

---

### Task 4: Add the Test Connection button and result panel to the form

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`

- [ ] **Step 1: Replace the form footer buttons section**

Find this block (around line 474):

```tsx
                            <div className="flex gap-4 mt-8">
                                <button
                                    type="submit"
                                    className="flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg transition"
                                >
                                    Save Configuration
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowForm(false);
                                        setSelectedPlatform(null);
                                    }}
                                    className="flex-1 bg-gray-500 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition"
                                >
                                    Cancel
                                </button>
                            </div>
```

Replace with:

```tsx
                            <div className="flex gap-4 mt-8">
                                <button
                                    type="button"
                                    onClick={() => handleTestConnection(selectedPlatform)}
                                    disabled={!isTestable(selectedPlatform) || testing}
                                    className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2"
                                >
                                    {testing ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                                            </svg>
                                            Testing…
                                        </>
                                    ) : 'Test Connection'}
                                </button>
                                <button
                                    type="submit"
                                    disabled={testing}
                                    className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-green-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition"
                                >
                                    Save Configuration
                                </button>
                                <button
                                    type="button"
                                    disabled={testing}
                                    onClick={() => {
                                        setShowForm(false);
                                        setSelectedPlatform(null);
                                        setTestResult(null);
                                    }}
                                    className="flex-1 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition"
                                >
                                    Cancel
                                </button>
                            </div>

                            {/* Test result panel */}
                            {testResult && (
                                <div className="mt-4 border rounded-lg overflow-hidden text-sm">
                                    <div className={`flex items-start gap-3 px-4 py-3 ${testResult.credential_ok ? 'bg-green-50 border-b border-green-100' : 'bg-red-50'}`}>
                                        <span className={`font-bold mt-0.5 ${testResult.credential_ok ? 'text-green-600' : 'text-red-600'}`}>
                                            {testResult.credential_ok ? '✓' : '✗'}
                                        </span>
                                        <div>
                                            <span className={`font-semibold ${testResult.credential_ok ? 'text-green-800' : 'text-red-800'}`}>Credentials</span>
                                            <p className={`mt-0.5 ${testResult.credential_ok ? 'text-green-700' : 'text-red-700'}`}>{testResult.credential_detail}</p>
                                        </div>
                                    </div>
                                    {testResult.credential_ok && (
                                        <div className={`flex items-start gap-3 px-4 py-3 ${
                                            testResult.webhook_status === 'registered' ? 'bg-green-50' :
                                            testResult.webhook_status === 'not_registered' ? 'bg-red-50' :
                                            'bg-gray-50'
                                        }`}>
                                            <span className={`font-bold mt-0.5 ${
                                                testResult.webhook_status === 'registered' ? 'text-green-600' :
                                                testResult.webhook_status === 'not_registered' ? 'text-red-600' :
                                                'text-gray-400'
                                            }`}>
                                                {testResult.webhook_status === 'registered' ? '✓' :
                                                 testResult.webhook_status === 'not_registered' ? '✗' : '—'}
                                            </span>
                                            <div>
                                                <span className={`font-semibold ${
                                                    testResult.webhook_status === 'registered' ? 'text-green-800' :
                                                    testResult.webhook_status === 'not_registered' ? 'text-red-800' :
                                                    'text-gray-600'
                                                }`}>Webhook</span>
                                                <p className={`mt-0.5 ${
                                                    testResult.webhook_status === 'registered' ? 'text-green-700' :
                                                    testResult.webhook_status === 'not_registered' ? 'text-red-700' :
                                                    'text-gray-500'
                                                }`}>{testResult.webhook_detail}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
```

- [ ] **Step 2: Verify in browser**

Start frontend: `cd frontend && npm run dev`
1. Go to `http://localhost:3000/admin/settings`
2. Click Configure on any platform
3. Leave required fields empty — confirm "Test Connection" button is disabled
4. Fill in dummy access_token (and phone_number_id for WhatsApp) — confirm button enables
5. Click "Test Connection" — confirm spinner shows, then result panel appears
6. Confirm result panel disappears when any field is edited

- [ ] **Step 3: Commit**

```bash
git add frontend/app/admin/settings/page.tsx
git commit -m "feat: add Test Connection button and inline result panel to platform config form"
```
