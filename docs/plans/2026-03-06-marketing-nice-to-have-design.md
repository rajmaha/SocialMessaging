# Marketing Module — Nice-to-Have Features Design

**Date:** 2026-03-06
**Status:** Approved
**Scope:** 5 enhancement features for the campaign marketing module

---

## 1. A/B Testing (Subject + Body Variants)

### New Model: `CampaignVariant`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| campaign_id | INTEGER FK | References campaigns(id) ON DELETE CASCADE |
| variant_label | VARCHAR(10) | "A" or "B" |
| subject | VARCHAR(500) | Variant-specific subject line |
| body_html | TEXT | Variant-specific body |
| split_percentage | INTEGER | e.g., 50 (percent of test audience) |
| sent_count | INTEGER DEFAULT 0 | |
| opened_count | INTEGER DEFAULT 0 | |
| clicked_count | INTEGER DEFAULT 0 | |

### Campaign Model Changes

| Column | Type | Notes |
|--------|------|-------|
| is_ab_test | BOOLEAN DEFAULT FALSE | Toggle A/B mode |
| ab_test_size_pct | INTEGER DEFAULT 20 | % of audience for test phase |
| ab_winner_variant_id | INTEGER FK (nullable) | Set when winner picked |
| ab_winner_criteria | VARCHAR(50) | "open_rate" or "click_rate" |
| ab_test_duration_hours | INTEGER DEFAULT 4 | Wait time before picking winner |

### Flow

1. Admin creates campaign, toggles "A/B Test" on
2. Two side-by-side editors for Variant A and Variant B (subject + body each)
3. Admin sets: test size %, winner criteria, test duration
4. On send: randomly split test-size audience into two groups, send respective variants
5. APScheduler job `pick_ab_winner`: runs every 5 min, checks campaigns with `is_ab_test=True` and `status='ab_testing'` where test duration has elapsed
6. Picks winner by open_rate or click_rate, sets `ab_winner_variant_id`
7. Auto-sends winner variant to remaining audience, updates status to "sent"
8. Stats page shows per-variant metrics with winner badge

### Campaign Status Extension

Add new status: `ab_testing` (between sending test variants and picking winner)

---

## 2. Click Tracking (Redirect Proxy)

### New Model: `CampaignLink`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| campaign_id | INTEGER FK | References campaigns(id) ON DELETE CASCADE |
| original_url | TEXT | The real destination URL |
| click_count | INTEGER DEFAULT 0 | Aggregate clicks |
| first_clicked_at | TIMESTAMPTZ | |
| last_clicked_at | TIMESTAMPTZ | |

### New Model: `CampaignClick`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| link_id | INTEGER FK | References campaign_links(id) ON DELETE CASCADE |
| recipient_id | INTEGER FK | References campaign_recipients(id) ON DELETE CASCADE |
| clicked_at | TIMESTAMPTZ DEFAULT NOW() | |
| ip_address | VARCHAR(45) | |
| user_agent | TEXT | |

### Campaign Model Changes

Add `clicked_count` (INTEGER DEFAULT 0) to Campaign.

### CampaignRecipient Changes

Add `clicked_at` (TIMESTAMPTZ nullable) — first click timestamp for this recipient.

### Send Logic Changes

During `_do_send`, after personalizing body:
1. Parse all `<a href="...">` tags using regex
2. For each unique URL, find-or-create a `CampaignLink` row
3. Rewrite href to: `{base_url}/campaigns/track/click/{campaign_id}/{link_id}/{recipient_id}`

### Public Endpoint

`GET /campaigns/track/click/{campaign_id}/{link_id}/{recipient_id}`
- Create `CampaignClick` row
- Increment `CampaignLink.click_count`
- If first click for recipient: set `CampaignRecipient.clicked_at`, increment `Campaign.clicked_count`
- 302 redirect to `CampaignLink.original_url`

### Stats Enhancement

- Add click rate (clicked_count / sent_count) to campaign stats
- Add top links table (URL, click count, unique clickers)
- Add clicked_at to per-recipient data

---

## 3. Advanced Segmentation (Tags + Engagement)

### Extended `target_filter` Schema

```json
{
  "statuses": ["new", "qualified"],
  "sources": ["website"],
  "tags": {
    "include": ["vip", "newsletter"],
    "exclude": ["churned"]
  },
  "engagement": {
    "opened_campaign": 5,
    "not_opened_campaign": 3,
    "clicked_campaign": 5
  }
}
```

### `_build_audience` Changes

After existing status/source filters:
- **Tags include:** Filter leads where `Lead.tags` JSON array contains ALL specified include tags
- **Tags exclude:** Filter leads where `Lead.tags` JSON array contains NONE of the exclude tags
- **Engagement opened_campaign:** JOIN CampaignRecipient where campaign_id matches and opened_at IS NOT NULL
- **Engagement not_opened_campaign:** LEFT JOIN CampaignRecipient where campaign_id matches and opened_at IS NULL (or no row)
- **Engagement clicked_campaign:** JOIN CampaignRecipient where campaign_id matches and clicked_at IS NOT NULL

### Frontend Changes

Campaign create/edit audience section gets:
- Tag multi-select with include/exclude toggle (reads tags from leads)
- Engagement filters: dropdown to select a past campaign + condition (opened / didn't open / clicked)
- Preview count updates live as filters change

---

## 4. Campaign Attachments

### New Model: `CampaignAttachment`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| campaign_id | INTEGER FK | References campaigns(id) ON DELETE CASCADE |
| filename | VARCHAR(255) | Original filename |
| file_path | VARCHAR(500) | Storage path on disk |
| content_type | VARCHAR(100) | MIME type |
| size_bytes | INTEGER | File size |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |

### Storage

Files saved to: `backend/app/attachment_storage/campaigns/{campaign_id}/`

### Endpoints

- `POST /campaigns/{campaign_id}/attachments` — multipart file upload (max 3 files, respects `branding_settings.max_file_size_mb`)
- `GET /campaigns/{campaign_id}/attachments` — list attachments
- `DELETE /campaigns/{campaign_id}/attachments/{attachment_id}` — remove attachment + file

### Send Logic Changes

During `_do_send`:
- Query campaign attachments
- For each file: create `MIMEBase` part, `encoders.encode_base64`, attach to message

### Frontend

- File upload dropzone on campaign create/edit page
- Shows attached files as chips with filename, size, and remove (X) button
- Validation: max 3 files, max size from branding settings

---

## 5. Dynamic Content Blocks

### Syntax

Handlebars-style conditional blocks in campaign HTML:

```html
{{#if tag="vip"}}
  <div>Exclusive VIP offer: 30% off!</div>
{{#else}}
  <div>Special offer: 10% off!</div>
{{/if}}

{{#if status="new"}}
  <div>Welcome aboard!</div>
{{/if}}
```

### Supported Conditions

| Condition | Example | Evaluates |
|-----------|---------|-----------|
| `tag="value"` | `tag="vip"` | Lead has tag "vip" in tags JSON array |
| `status="value"` | `status="new"` | Lead.status == "new" |
| `source="value"` | `source="website"` | Lead.source == "website" |

Each `{{#if}}` can have an optional `{{#else}}` fallback block.

### Processing

New function `_process_dynamic_blocks(html: str, lead) -> str`:
- Called during `_do_send` BEFORE `_replace_tags`
- Uses regex to find `{{#if condition="value"}}...{{#else}}...{{/if}}` patterns
- Evaluates condition against lead data
- Replaces block with matching content (if-branch or else-branch)
- Nested blocks NOT supported (keep it simple)

### Frontend: EmailEditor Enhancement

- Add "Dynamic Block" button to EmailEditor toolbar (between merge tags and formatting)
- Clicking inserts a template block at cursor position
- Condition picker: dropdown for field (tag/status/source) + input for value
- Visual rendering: show both if/else branches with a colored label indicating the condition
- Preview mode: user can select a sample lead to see rendered output

---

## Files to Create/Modify

### Backend (new files)
- `backend/app/models/campaign_variant.py` — CampaignVariant model
- `backend/app/models/campaign_link.py` — CampaignLink, CampaignClick models
- `backend/app/models/campaign_attachment.py` — CampaignAttachment model
- `backend/app/schemas/campaign_variant.py` — variant schemas
- `backend/app/schemas/campaign_link.py` — link/click schemas
- `backend/app/schemas/campaign_attachment.py` — attachment schemas
- `backend/app/routes/campaign_attachments.py` — attachment upload/list/delete

### Backend (modify)
- `backend/app/models/campaign.py` — add A/B fields, clicked_count
- `backend/app/models/__init__.py` — register new models
- `backend/app/routes/campaigns.py` — click tracking endpoint, A/B send logic, dynamic block processing, segmentation filters
- `backend/main.py` — migration SQL for new tables/columns, A/B winner scheduler job

### Frontend (new files)
- `frontend/components/ABTestEditor.tsx` — side-by-side variant editors
- `frontend/components/DynamicBlockInserter.tsx` — condition picker + block inserter
- `frontend/components/CampaignAttachmentUpload.tsx` — file dropzone
- `frontend/components/AdvancedSegmentFilter.tsx` — tag + engagement filter UI

### Frontend (modify)
- `frontend/app/admin/campaigns/new/page.tsx` — add A/B toggle, attachment upload, advanced filters, dynamic block support
- `frontend/app/admin/campaigns/[id]/edit/page.tsx` — same changes
- `frontend/app/admin/campaigns/[id]/page.tsx` — enhanced stats (click rate, per-variant, top links)
- `frontend/components/EmailEditor.tsx` — add dynamic block toolbar button

---

## Implementation Order

1. **Click Tracking** (foundation — A/B testing needs click data for winner criteria)
2. **Advanced Segmentation** (independent, enhances audience targeting)
3. **A/B Testing** (depends on click tracking for click_rate winner criteria)
4. **Campaign Attachments** (independent, simple)
5. **Dynamic Content Blocks** (independent, touches email editor)
