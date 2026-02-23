# Webhook Setup Quick Reference

Quick checklist for setting up webhooks for 2-way messaging on each platform.

## Facebook Messenger Setup Checklist

### ✅ Create App & Get Credentials
- [ ] Go to https://developers.facebook.com/
- [ ] Click "My Apps" → "Create App"
- [ ] Choose "Manage Business" as app purpose
- [ ] Add Messenger product to app
- [ ] Go to Messenger → Tools → Tokens
- [ ] Generate Page Access Token: `EAABs...`
- [ ] Copy App ID: `1234567890`
- [ ] Copy App Secret: `a1b2c3d4...`

### ✅ Configure Webhook
- [ ] Go to Messenger → Settings → Webhooks
- [ ] Click "Add Callback URL"
- [ ] Callback URL: `https://yourdomain.com/webhooks/facebook`
- [ ] Verify Token: `my_facebook_verify_token_2026`
- [ ] Click "Verify and Save"

### ✅ Subscribe to Events
- [ ] Check: `messages`
- [ ] Check: `messaging_postbacks`
- [ ] Check: `messaging_reads`
- [ ] Check: `message_deliveries`
- [ ] Click "Save"

### ✅ Subscribe Page
- [ ] Select your Facebook Page
- [ ] Click "Subscribe"

### ✅ Add to .env
```env
FACEBOOK_APP_ID=1234567890123456
FACEBOOK_APP_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
FACEBOOK_PAGE_ACCESS_TOKEN=EAAbkrLDzc1gBAKJZCyZC6D7qh1cOZCZBzKqKJZAohB9ZBzZALfE1v6kOZCZB3O...
FACEBOOK_WEBHOOK_VERIFY_TOKEN=my_facebook_verify_token_2026
FACEBOOK_PAGE_ID=1234567890123456
```

### ✅ Test Webhook
- [ ] Use ngrok: `ngrok http 8000`
- [ ] Update Facebook webhook with ngrok URL
- [ ] Send test message to your page
- [ ] Check application logs for webhook delivery
- [ ] Verify message appears in application

---

## WhatsApp Business API Setup Checklist

### ✅ Create WhatsApp Account
- [ ] Go to https://business.facebook.com
- [ ] Access WhatsApp Business → Get Started
- [ ] Verify business phone number
- [ ] Wait for approval (1-3 days)

### ✅ Get Credentials
- [ ] Note WhatsApp Phone Number: `+1 234 567 8900`
- [ ] Copy Phone Number ID: `1234567890123456`
- [ ] Copy Business Account ID: `1234567890123456`
- [ ] Go to App → Settings → Basic
- [ ] Copy API Access Token: `EAAbkrLDzc1gBAKJZCyZC6D7qh1cOZCZBzKqKJZAohB9...`

### ✅ Configure Webhook
- [ ] Go to WhatsApp → Configuration
- [ ] Click "Edit" under Webhook
- [ ] Callback URL: `https://yourdomain.com/webhooks/whatsapp`
- [ ] Verify Token: `my_whatsapp_verify_token_2026`
- [ ] Click "Verify and Save"

### ✅ Subscribe to Events
- [ ] Check: `messages`
- [ ] Check: `message_template_status_update`
- [ ] Check: `message_status`
- [ ] Check: `account_alerts`

### ✅ Register Test Number
- [ ] Add your phone number as test sender
- [ ] Enter SMS verification code
- [ ] Number now ready for testing

### ✅ Add to .env
```env
WHATSAPP_BUSINESS_ACCOUNT_ID=1234567890123456
WHATSAPP_PHONE_NUMBER_ID=1234567890123456
WHATSAPP_PHONE_NUMBER=+12025551234
WHATSAPP_ACCESS_TOKEN=EAAbkrLDzc1gBAKJZCyZC6D7qh1cOZCZBzKqKJZAohB9ZBzZALfE1v6kOZCZB3O...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=my_whatsapp_verify_token_2026
```

### ✅ Test Webhook
- [ ] Send WhatsApp message from test number to business number
- [ ] Check logs for `POST /webhooks/whatsapp - 200 OK`
- [ ] Verify message appears in application
- [ ] Send test response message via API

---

## Viber Bot Setup Checklist

### ✅ Create Bot
- [ ] Go to https://partners.viber.com/
- [ ] Sign up / Login
- [ ] Click "Create Bot"
- [ ] Bot Name: `SocialMediaMessenger`
- [ ] Category: Business
- [ ] Upload logo/avatar
- [ ] Click "Create"

### ✅ Get Bot Token
- [ ] Go to Bot Dashboard
- [ ] Settings → Account
- [ ] Copy Bot Token: `45a5f8e0e3f4e5d6-a5e5c8d4f1e2b3a4-c6d7e8f9a0b1c2d3`
- [ ] Copy Public Key (starts with `-----BEGIN PUBLIC KEY-----`)

### ✅ Configure Webhook
- [ ] Go to Bot Settings → Webhook
- [ ] Webhook URL: `https://yourdomain.com/webhooks/viber`
- [ ] Click "Save"

### ✅ Set Webhook Events
- [ ] Check: Incoming messages
- [ ] Check: Delivered
- [ ] Check: Read
- [ ] Check: Failed
- [ ] Check: Subscribed
- [ ] Check: Unsubscribed

### ✅ Add to .env
```env
VIBER_BOT_TOKEN=45a5f8e0e3f4e5d6-a5e5c8d4f1e2b3a4-c6d7e8f9a0b1c2d3
VIBER_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
-----END PUBLIC KEY-----
```

### ✅ Test Webhook
- [ ] Open Viber app
- [ ] Find your bot
- [ ] Send `/start` command
- [ ] Verify bot responds with welcome message
- [ ] Send test message
- [ ] Check logs for webhook delivery
- [ ] Verify message appears in application

---

## LinkedIn Messaging Setup Checklist

### ✅ Create LinkedIn App
- [ ] Go to https://www.linkedin.com/developers/apps
- [ ] Click "Create app"
- [ ] App Name: `SocialMediaMessenger`
- [ ] Select your LinkedIn Page
- [ ] Upload app logo
- [ ] Accept terms
- [ ] Click "Create app"

### ✅ Get Credentials
- [ ] Go to App Dashboard → Auth tab
- [ ] Copy Client ID: `86abcdef123456`
- [ ] Copy Client Secret: `AbCdEfGhIjKlMnOpQrStUvWxYz123456`
- [ ] Generate Access Token (via OAuth or request admin token)
- [ ] Copy Access Token: `AQVr8i1YvZc1z8h6Q9X5Y7Z2A4B6C8D0E2F4...`
- [ ] Find Organization ID from LinkedIn page URL: `12345678`

### ✅ Enable Messaging Product
- [ ] Go to Product tab
- [ ] Add "Messaging" product
- [ ] Add webhook

### ✅ Configure Webhook
- [ ] Set Webhook URL: `https://yourdomain.com/webhooks/linkedin`
- [ ] Subscribe to events:
  - [ ] `message_created`
  - [ ] `message_read`

### ✅ Add to .env
```env
LINKEDIN_CLIENT_ID=86abcdef123456
LINKEDIN_CLIENT_SECRET=AbCdEfGhIjKlMnOpQrStUvWxYz123456
LINKEDIN_ACCESS_TOKEN=AQVr8i1YvZc1z8h6Q9X5Y7Z2A4B6C8D0E2F4...
LINKEDIN_ORGANIZATION_ID=12345678
LINKEDIN_WEBHOOK_VERIFY_TOKEN=my_linkedin_verify_token_2026
```

### ✅ Test Webhook
- [ ] Send DM to your company LinkedIn page
- [ ] Check logs for webhook delivery
- [ ] Verify message appears in application

---

## Backend Setup Checklist

### ✅ Create Webhook Routes File
- [ ] Create `backend/app/routes/webhooks.py`
- [ ] Add Facebook webhook handler
- [ ] Add WhatsApp webhook handler
- [ ] Add Viber webhook handler
- [ ] Add LinkedIn webhook handler

### ✅ Update Main Backend File
- [ ] Open `backend/main.py`
- [ ] Import webhooks router
- [ ] Add `app.include_router(webhooks.router)`
- [ ] Save file

### ✅ Install Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### ✅ Test Backend
- [ ] Start backend: `python -m uvicorn main:app --reload`
- [ ] Health check: `curl http://localhost:8000/health`
- [ ] Should return: `{"status":"ok",...}`

---

## Environment Variables Template

```env
# ======== FACEBOOK MESSENGER ========
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_WEBHOOK_VERIFY_TOKEN=

# ======== WHATSAPP BUSINESS ========
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_PHONE_NUMBER=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# ======== VIBER BOT ========
VIBER_BOT_TOKEN=
VIBER_PUBLIC_KEY=

# ======== LINKEDIN MESSAGING ========
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_ORGANIZATION_ID=
LINKEDIN_WEBHOOK_VERIFY_TOKEN=

# ======== DATABASE ========
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia

# ======== FRONTEND ========
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Testing Commands

### Test Facebook Webhook
```bash
curl -X POST http://localhost:8000/webhooks/facebook \
  -H 'Content-Type: application/json' \
  -d '{
    "object": "page",
    "entry": [{
      "messaging": [{
        "sender": {"id": "123456789"},
        "recipient": {"id": "987654321"},
        "timestamp": 1234567890000,
        "message": {"text": "Hello!"}
      }]
    }]
  }'
```

### Test WhatsApp Webhook
```bash
curl -X POST http://localhost:8000/webhooks/whatsapp \
  -H 'Content-Type: application/json' \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "1234567890",
            "timestamp": 1234567890,
            "text": {"body": "Hello!"}
          }],
          "contacts": [{
            "profile": {"name": "John"}
          }]
        }
      }]
    }]
  }'
```

### Test Viber Webhook
```bash
curl -X POST http://localhost:8000/webhooks/viber \
  -H 'Content-Type: application/json' \
  -d '{
    "event": "message",
    "sender": {"id": "user123", "name": "John"},
    "message": {"text": "Hello!"},
    "timestamp": 1234567890000
  }'
```

### Test LinkedIn Webhook
```bash
curl -X POST http://localhost:8000/webhooks/linkedin \
  -H 'Content-Type: application/json' \
  -d '{
    "eventMeta": {"type": "CREATE"},
    "id": "msg123",
    "conversationId": "conv456",
    "from": "user789",
    "body": {"text": "Hello!"}
  }'
```

---

## Common Issues & Quick Fixes

| Issue | Quick Fix |
|-------|-----------|
| Webhook not receiving messages | Verify page/account is subscribed to webhook |
| "Invalid verify token" error | Check .env token matches platform settings |
| HTTPS required error | Use ngrok for localhost testing |
| Webhook timing out | Check backend is running on port 8000 |
| Messages not saving to DB | Verify DATABASE_URL is correct in .env |
| No webhook delivery logs | Check webhook events are subscribed in platform |

---

## Production Deployment Checklist

- [ ] Change all webhook URLs from `localhost` to production domain
- [ ] Use HTTPS (not HTTP) for all webhooks
- [ ] Regenerate all verify tokens with strong random strings
- [ ] Store all tokens in secure environment variables
- [ ] Enable webhook signature verification
- [ ] Set up monitoring/alerting for webhook failures
- [ ] Test end-to-end on staging before production
- [ ] Implement message queue for high volume (Redis/Celery)
- [ ] Set up database backups
- [ ] Enable CORS only for your domain
- [ ] Implement rate limiting on webhook endpoints

---

## Support & Resources

- **Full Setup Guide**: [WEBHOOKS_SETUP.md](./WEBHOOKS_SETUP.md)
- **Facebook API**: https://developers.facebook.com/docs/messenger-platform
- **WhatsApp API**: https://developers.facebook.com/docs/whatsapp/cloud-api
- **Viber Bot API**: https://viber.github.io/docs/general/rich-media-message/
- **LinkedIn API**: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/

---

**Last Updated**: February 22, 2026  
**Version**: 1.0
