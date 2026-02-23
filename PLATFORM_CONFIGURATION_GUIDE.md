# Platform Configuration & Settings Guide

Complete guide to all required and recommended configurations for Facebook, WhatsApp, Viber, and LinkedIn beyond webhook setup.

## Table of Contents
1. [Facebook Messenger Setup](#facebook-messenger-setup)
2. [WhatsApp Business Setup](#whatsapp-business-setup)
3. [Viber Bot Setup](#viber-bot-setup)
4. [LinkedIn Messaging Setup](#linkedin-messaging-setup)
5. [Compliance & Verification](#compliance--verification)
6. [Monitoring & Analytics](#monitoring--analytics)
7. [Advanced Features](#advanced-features)

---

## Facebook Messenger Setup

### Essential Configurations

#### 1. **App Roles & Permissions**

Go to: **App Roles** → **Admins**

| Role | Permissions | Who Should Have |
|------|-------------|-----------------|
| **Admin** | Everything including billing | You (app owner) |
| **Developer** | API access, code changes | Development team |
| **Analyst** | View insights, no changes | Analytics team |
| **Tester** | Test app only | QA team |

```
Setup:
1. Go to Settings → Roles
2. Click "Add Admins/Developers"
3. Search for team member email
4. Select role
5. Click "Add"
```

#### 2. **Message Tags Configuration**

Message tags allow you to send messages outside the 24-hour window.

Go to: **Settings** → **Messaging Tags**

```
Available Tags:
┌─────────────────────────────────────────────────────────┐
│ STANDARD TAGS (24-hour rule applies)                   │
├─────────────────────────────────────────────────────────┤
│ 🏢 BUSINESS_RECOVERED - Account/business recovery      │
│ 📋 CONFIRMED_EVENT_UPDATE - Event confirmation         │
│ 🎟️ EVENT_REMINDER - Reminder for upcoming event        │
│ 📦 ORDER_UPDATE - Order status change                  │
│ 🔐 ACCOUNT_UPDATE - Account security update            │
│ 📍 PERSONAL_FINANCE - Finance update                   │
│ 🎓 HUMAN_AGENT - Quick response time required           │
│ 🔔 PAIRING_UPDATE - Device pairing update              │
│ 📱 PHONE_CHANGE - Phone number change alert             │
│ 🧹 RECURRING_SUBSCRIPTION - Subscription billing       │
└─────────────────────────────────────────────────────────┘
```

**Setup Message Tags:**
```
1. Go to Settings → Message Tags
2. Click "Request Tag"
3. Select tag type
4. Describe use case (50+ words required)
5. Submit for review (takes 1-3 business days)
6. Once approved, use in API calls with:
   "tag": "BUSINESS_RECOVERED"
```

#### 3. **Sender's Display Name**

Go to: **Settings** → **Sender Name**

```
Requirements:
- 2-30 characters
- Business name or brand name
- No special characters except: - _ ( )
- Must not be misleading

Example:
"John's Store" ✅
"JS_Support" ✅
"🚀 Rockets" ❌ (emoji not allowed)
```

#### 4. **Quick Replies Setup**

Quick replies appear as buttons below chat box.

```python
# Example API call:
{
  "messaging_type": "RESPONSE",
  "recipient": {"id": "USER_ID"},
  "message": {
    "text": "What would you like help with?",
    "quick_replies": [
      {
        "content_type": "text",
        "title": "Order Status",
        "payload": "ORDER_STATUS"
      },
      {
        "content_type": "text",
        "title": "Track Package",
        "payload": "TRACK_PACKAGE"
      },
      {
        "content_type": "text",
        "title": "Talk to Agent",
        "payload": "TALK_TO_AGENT"
      }
    ]
  }
}
```

#### 5. **Persistent Menu Setup**

Persistent menu appears as button at bottom of chat.

Go to: **Settings** → **Persistent Menu**

```
Configuration Structure:
{
  "persistent_menu": [
    {
      "locale": "default",
      "composer_input_disabled": false,
      "call_to_actions": [
        {
          "type": "postback",
          "title": "View Orders",
          "payload": "VIEW_ORDERS"
        },
        {
          "type": "web_url",
          "title": "Visit Website",
          "url": "https://yoursite.com"
        },
        {
          "type": "postback",
          "title": "Help",
          "payload": "HELP"
        }
      ]
    }
  ]
}
```

#### 6. **Greeting Text**

Go to: **Settings** → **Greeting Text**

```
When user first opens chat:
"Hi! 👋 Welcome to our store. How can we help?"

Requirements:
- 50-160 characters
- Should be welcoming
- Include call-to-action
```

#### 7. **Get Started Button**

Go to: **Settings** → **Get Started Button**

```
Configuration:
- Message: "Get Started"
- Payload: "GET_STARTED"
- Appears only to users who haven't sent you a message yet
```

#### 8. **Webhook Subscription Fields (Extra)**

In addition to basic subscription, subscribe to:

```
Recommended Additional Fields:
□ messaging_game_plays
□ messaging_optins
□ messaging_optouts
□ messaging_referrals
□ message_echoes
□ standby.in
□ standby.out
```

#### 9. **App Domains Configuration**

Go to: **Settings** → **Basic**

```
Add your domain to:
1. App Domains: yourdomain.com
2. Redirect URIs:
   - https://yourdomain.com/auth/facebook/callback
   - https://yourdomain.com/settings
3. Website URL: https://yourdomain.com
```

#### 10. **Rate Limiting Configuration**

Facebook applies rate limits:

```
Limits:
- 60 messages/second per user
- 200 messages/minute per user
- 1000 API calls/100 seconds

To Handle High Volume:
1. Use message queue (Redis/Celery)
2. Batch messages if possible
3. Request higher limits from Facebook:
   - Go to Settings → Rate Limits
   - Click "Request Higher Limit"
   - Describe use case
```

---

## WhatsApp Business Setup

### Essential Configurations

#### 1. **Business Phone Number Verification**

Go to: **WhatsApp Business** → **Phone Numbers**

```
Verification Steps:
1. Phone number must be verified (SMS or call)
2. Receive verification code
3. Enter code in system
4. Phone now verified and ready

Important:
- Only one phone number per business account
- Can switch to different number (monthly limit)
- Number must receive SMS/calls
```

#### 2. **Business Profile Setup**

Go to: **WhatsApp Business** → **Business Profile**

```
Fill in:
□ Business Name (1-30 characters)
□ Business Category
   - Retail
   - Technology
   - Finance
   - Healthcare
   - etc.
□ Business Description (1-139 characters)
□ Business Address
□ Business Website
□ Business Email
□ Business Phone
□ Profile Picture (logo)
```

#### 3. **Message Templates**

Message templates are pre-approved messages for common scenarios.

Go to: **Message Templates** → **Create Template**

```
Template Categories:
├── AUTHENTICATION (OTP, password reset)
├── MARKETING (promotions, announcements)
├── UTILITY (order updates, reminders)
└── SERVICE (customer support, tickets)

Example Template:
Name: order_confirmation
Language: English
Body: "Hi {{1}}, your order {{2}} has been confirmed.
       Delivery expected: {{3}}. Track here: {{4}}"

Variables:
{{1}} = customer_name
{{2}} = order_id
{{3}} = delivery_date
{{4}} = tracking_url
```

**Set Up Templates:**
```
1. Go to Templates section
2. Click "Create Template"
3. Enter:
   - Template Name (underscores, no spaces)
   - Category (AUTHENTICATION/MARKETING/UTILITY/SERVICE)
   - Languages
   - Message body with {{variable}} placeholders
4. Add media (optional):
   - Header image
   - Footer text
   - Buttons (Call to Action)
5. Submit for approval (usually 1 hour)
```

#### 4. **API Version Management**

Go to: **Settings** → **API Version**

```
Check your API version:
- v18.0 (current/recommended)
- v17.0 (previous)

To Upgrade:
1. Test on v18.0 in sandbox
2. Verify all endpoints work
3. Update code with new version
4. Deploy to production

Breaking Changes to Check:
- Webhook payload format
- Message type definitions
- New required fields
```

#### 5. **Webhook Security - Signature Verification**

Go to: **Webhooks** → **Webhook Events**

```
Every webhook from WhatsApp includes signature header:
X-Hub-Signature: sha1=SIGNATURE

Verify signature:
1. Get APP_TOKEN from settings
2. Read request body (raw bytes)
3. Calculate HMAC:
   signature = HMAC-SHA1(APP_TOKEN, body)
4. Compare with header value

Python Example:
import hmac
import hashlib

def verify_webhook_signature(request):
    token = os.getenv("WHATSAPP_APP_SECRET")
    signature = request.headers.get("X-Hub-Signature")
    body = request.body
    
    expected = "sha1=" + hmac.new(
        token.encode(),
        body,
        hashlib.sha1
    ).hexdigest()
    
    return signature == expected
```

#### 6. **Quality Rating Configuration**

Go to: **Quality Management** → **Quality Rating**

```
Your WhatsApp Business Account quality rating:
Range: 1 (Poor) - 5 (Excellent)

Factors Affecting Rating:
- Message blocked/reported by users
- Message bounce rate
- Phone number flagged for abuse
- Conversation quality score

This affects:
- Message delivery speed
- API access tier
- Support priority

Improve Quality:
□ Don't send spam/unsolicited messages
□ Only use approved message templates
□ Remove inactive numbers from lists
□ Respond quickly to user messages
□ Respect opt-out requests
```

#### 7. **Display Templates Setup**

Set which templates appear in UI.

Go to: **Templates** → **Settings**

```
Configure:
- Show templates on mobile app
- Show templates on web
- Default message language
- Template availability by region
```

#### 8. **Conversation Settings**

Go to: **Settings** → **Conversation**

```
Configure:
□ Auto-reply message (if offline)
□ Away message (after hours)
□ Response time target
└─ Usually message within hours

Example Auto-reply:
"Thanks for your message! 
We typically respond within 2 hours.
To help faster, please provide:
1. Your order number (if applicable)
2. Brief description of issue"
```

#### 9. **Business Account Linking**

Link WhatsApp to other Meta services.

Go to: **Settings** → **Linked Accounts**

```
Link to:
□ Facebook Page
□ Instagram Business Account
□ Messaging inbox (to manage all chats from one place)

Benefits:
- Unified customer view
- Cross-platform messaging
- Shared contact list
- Consistent branding
```

#### 10. **Rate Limiting & Throughput**

```
Tier 1 (Starter):
- 1000 messages/day
- Request tier upgrade after 30 days of quality

Tier 2 (Growing):
- 10,000 messages/day
- Requires verified phone number + quality rating

Tier 3 (Professional):
- 100,000+ messages/day
- Requires API usage review

To Upgrade:
1. Meet quality requirements
2. Contact WhatsApp support
3. Submit throughput request
4. Approval usually in 1-3 days
```

---

## Viber Bot Setup

### Essential Configurations

#### 1. **Bot Behavior Settings**

Go to: **Bot Settings** → **Behavior**

```
Configure:
□ Greeting Text (bot intro)
□ Default Response (user says something unexpected)
□ Min API Version (Viber app version requirement)
□ Bot Admin Email (for notifications)
```

Example:
```
Greeting Text:
"Hi! 👋 I'm your support bot. I can help with:
1. Order tracking
2. Product info
3. Connect to agent"

Default Response:
"Sorry, I didn't understand. Type:
/help - for options
/menu - for main menu
/agent - talk to human"
```

#### 2. **Categories & Keywords**

Go to: **Bot Settings** → **Categories**

```
Set bot categories:
□ Shopping
□ Business
□ Entertainment
□ Health & Fitness
□ Travel
□ News
□ etc.

Example:
Category: Shopping
Keywords: online store, e-commerce, shop, buy

Benefits:
- Better bot discovery
- Relevant search results
- User expectations set correctly
```

#### 3. **Bot Avatar & Design**

Go to: **Profile** → **Avatar**

```
Requirements:
- Format: JPG or PNG
- Size: 512x512 pixels
- Max file size: 2MB
- Square format

Design Tips:
- Use brand logo
- Ensure clear at small size
- Include company colors
- Test on light & dark backgrounds
```

#### 4. **Rich Media Templates**

Set up for sending rich messages.

```python
# Example Rich Message:
{
  "type": "text",
  "text": "Check out our products:",
  "rich_media": {
    "buttons": [
      {
        "Columns": 2,
        "Rows": 2,
        "ActionType": "open-url",
        "ActionBody": "https://example.com/products",
        "Image": "https://example.com/product.jpg",
        "Text": "Browse Products"
      }
    ]
  }
}
```

#### 5. **Webhook Event Configuration**

Go to: **Webhooks** → **Events**

```
Subscribe to:
□ message - incoming messages
□ subscribed - user subscribes to bot
□ unsubscribed - user unsubscribes
□ delivered - message delivered
□ read - message read
□ failed - message failed
□ conversation_started - user opens chat first time
```

#### 6. **Admin Notifications**

Go to: **Notifications** → **Admin Email**

```
Receive alerts for:
□ New subscribers
□ High message volume
□ API errors
□ Rate limits exceeded
□ Bot offline/Down

Admin Email:
your-email@yourdomain.com
```

#### 7. **Sticker Pack Setup**

Allow users to receive stickers.

Go to: **Resources** → **Sticker Packs**

```
Create Sticker Pack:
1. 40x40 pixels (minimum)
2. PNG format with transparency
3. Unique names for each sticker
4. 1MB per sticker max
5. Up to 100 stickers per pack

Example use:
When user performs action:
→ Send celebration sticker
→ Send success indicator
→ Send emoji-style response
```

#### 8. **Keyboard Configuration**

Send custom keyboards to users.

```python
# Keyboard Example:
{
  "type": "keyboard",
  "buttons": [
    {
      "columns": 2,
      "rows": 1,
      "text": "See menu",
      "action_type": "reply",
      "action_body": "menu"
    },
    {
      "columns": 2,
      "rows": 1,
      "text": "Call agent",
      "action_type": "open-url",
      "action_body": "tel:+1234567890"
    }
  ]
}
```

#### 9. **Sponsored Stickers & Promotions**

Go to: **Promotions** → **Sponsored Content**

```
Configure:
□ Allow promotional messages
□ Frequency limits
□ Preferred message times
□ Target audience segments
```

#### 10. **Accessibility Settings**

Go to: **Settings** → **Accessibility**

```
Configure:
□ Text size options
□ Language support (auto-detect user preference)
□ Audio descriptions
□ High contrast mode support
```

---

## LinkedIn Messaging Setup

### Essential Configurations

#### 1. **Company Page Messaging Setup**

Go to: **LinkedIn Admin** → **Company Page** → **Messaging**

```
Enable Direct Messaging:
1. Go to Company Page Settings
2. Select "Messaging"
3. Enable "Allow visitors to message your page"
4. Set messaging hours:
   - 24/7 or specific hours
   - Set timezone
5. Assign messaging team members
```

#### 2. **Response Settings**

Go to: **Messaging Settings** → **Response Configuration**

```
Configure:
□ Auto-response message (when received)
□ Away message (after hours)
□ Response time expectation
   - Within minutes
   - Within hours
   - Within 1 day

Example Auto-response:
"Thanks for reaching out!
We typically respond within 24 hours.
For urgent matters, please call: +1-800-123-4567"
```

#### 3. **Messaging Team Assignment**

Go to: **Messaging** → **Team Management**

```
Add team members:
1. Click "Manage Messaging Team"
2. Search for LinkedIn connections
3. Select role:
   - Primary owner
   - Reader (view only)
   - Responder (can reply)
   - Manager (full control)
4. Save permissions
```

#### 4. **Message Templates**

LinkedIn doesn't have pre-approved templates, but set standard responses.

```
Store these in your system:

Template: Welcome
"Hi {{name}},
Thanks for your interest in {{company}}.
How can we help today?"

Template: Product Inquiry
"Great question about {{product}}!
Let me share some details:
- Features: {{features}}
- Pricing: Starting at {{price}}
Would you like to schedule a demo?"

Template: Support
"Sorry to hear you're experiencing issues.
Can you please provide:
1. Issue description
2. When it started
3. Screenshots (if applicable)"
```

#### 5. **LinkedIn Conversational Ads**

Go to: **Campaign Manager** → **Ads**

```
Enable messaging ads:
1. Create ad campaign
2. Select "Conversation Ads" format
3. Link to LinkedIn messaging
4. Users can message directly from ad

This allows:
- Website visitors to message
- Ad clickers to start conversations
- FAQ questions via messaging
```

#### 6. **Profile Information Update**

Go to: **Company Page** → **Edit**

```
Update:
□ Company logo (512x512)
□ Cover photo (1200x627)
□ Company description
□ Industry classification
□ Company size
□ Website URL
□ Phone number
□ Business address

Important:
These appear in user's chat with you,
so keep updated with current info.
```

#### 7. **Webhooks Security**

LinkedIn signs all webhooks.

```python
# Verify LinkedIn Webhook Signature:
import hmac
import hashlib
import json

def verify_linkedin_signature(request):
    secret = os.getenv("LINKEDIN_CLIENT_SECRET")
    signature = request.headers.get("X-LinkedIn-Signature")
    
    # Get raw body
    body = request.get_data()
    
    # Calculate expected signature
    expected = hmac.new(
        secret.encode(),
        body,
        hashlib.sha256
    ).hexdigest()
    
    return signature == expected
```

#### 8. **LinkedIn Analytics for Messaging**

Go to: **Analytics** → **Messaging**

```
Track:
□ Number of conversations started
□ Average response time
□ Conversation completion rate
□ User satisfaction (if ratings enabled)
□ Top questions asked
□ Conversion rates

Use this data to:
- Improve response times
- Create better templates
- Identify common issues
- Train team members
```

#### 9. **Data Privacy & GDPR Compliance**

Go to: **Settings** → **Privacy**

```
Configure:
□ Message retention period (default: 90 days)
□ User data deletion
□ Privacy policy link
□ Data processing agreement

Important:
- LinkedIn requires GDPR compliance
- Can't store messages indefinitely
- User can request data deletion
- Must honor opt-out requests
```

#### 10. **API Rate Limits**

LinkedIn has rate limits:

```
Limits:
- 100 API calls per 100 seconds per app
- 2000 conversations per month free tier
- Upgrade for higher limits

To Track:
- Monitor X-RateLimit-Limit header
- Log X-RateLimit-Remaining
- Implement exponential backoff

Example:
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 43
X-RateLimit-Reset: 1613644800
```

---

## Compliance & Verification

### Facebook Compliance

#### GDPR Configuration
```
1. Add privacy policy URL
2. Update Terms of Service
3. Implement data deletion API
4. Log user consent
5. Document data processing
```

#### Age Verification
```
Go to: Settings → Demographics
- Ensure chat restricted to 18+
- Minor protection policies
- Parental consent tracking (if needed)
```

### WhatsApp Compliance

#### Business Registration
```
Required:
□ Business legal name
□ Business address
□ Business phone
□ Business category
□ Tax ID (some regions)

Verification levels:
- Unverified (basic)
- Verified (green checkmark)
- Premium (business account)

Benefits of Verification:
- Green badge
- Higher message delivery
- Better quality rating
- Increased limits
```

#### Message Opt-In Tracking
```
Store user opt-in status:
□ User explicitly subscribed
□ Subscription method (form, chat, etc.)
□ Subscription date/time
□ User can opt-out anytime

Never send to:
❌ Users who haven't opted in
❌ Users who have opted out
❌ Invalid/inactive numbers
```

### Viber Compliance

#### Terms of Service
```
1. Add bot description
2. Link to privacy policy
3. Disclose data collection
4. Allow opt-out
5. Respect user privacy
```

#### Content Policies
```
Allowed:
✓ Customer support
✓ Order updates
✓ Marketing (if opted-in)
✓ Account alerts

Prohibited:
✗ Spam
✗ Content from banned categories
✗ Abusive messages
✗ Phishing/fraud
```

### LinkedIn Compliance

#### Privacy Requirements
```
1. Privacy policy on website
2. Data processing agreement
3. Clear messaging purpose
4. User consent tracking
5. Data retention explained
```

#### Terms of Service
```
Agree to:
- LinkedIn API Terms
- Data sharing limitations
- No spamming/marketing without consent
- No selling user data
```

---

## Monitoring & Analytics

### Facebook Insights
```
Access: Analytics → Messages

Track:
- Daily active conversations
- Sticker gets/sends
- Quick reply effectiveness
- Message volume over time
- User retention rate
```

### WhatsApp Business Analytics
```
Access: Dashboard → Analytics

Monitor:
- Messages sent/received (daily)
- Quality rating trend
- Phone number health status
- Template performance
- User segments
```

### Viber Bot Analytics
```
Access: Dashboard Stats

Track:
- Messages received
- Users (active, total)
- Sticker engagement
- API errors
- Response times
```

### LinkedIn Company Analytics
```
Access: Analytics → Overview

Monitor:
- Visitor demographics
- Message engagement
- Update performance
- Employee activity
- Follower growth
```

---

## Advanced Features

### Facebook Advanced

1. **Handover Protocol**
```
Switch between bot and human agent:
- Bot handles simple queries
- Complex issues handed to agent
- Agent can hand back to bot
- User context preserved
```

2. **Broadcast Messages**
```
Send to multiple users:
- Create broadcast
- Select recipient list
- Use template tags
- Schedule send time
- Track delivery
```

### WhatsApp Advanced

1. **List Messages**
```python
{
  "type": "interactive",
  "interactive": {
    "type": "list",
    "body": {
      "text": "Choose an option:"
    },
    "action": {
      "button": "Select",
      "sections": [
        {
          "title": "Orders",
          "rows": [
            {"id": "1", "title": "Track Order"},
            {"id": "2", "title": "Cancel Order"}
          ]
        }
      ]
    }
  }
}
```

2. **Reply Buttons**
```
Interactive messages with buttons
- Predefined responses
- No typing needed
- Better user experience
```

### Viber Advanced

1. **Rich Media Messages**
```
Send media-rich content:
- Images with buttons
- Video recordings
- Links with preview
- Location sharing
```

2. **Admin Approval System**
```
Set up:
- Message approval workflow
- Admin review queue
- Scheduled sending
- A/B testing capability
```

### LinkedIn Advanced

1. **Lead Gen Forms**
```
Collect info via messaging:
- User fills form in chat
- Data synced to CRM
- Auto-response sent
- Lead qualification
```

2. **Event Messaging**
```
Notify about:
- Upcoming events
- Job postings
- Company announcements
- Webinar registrations
```

---

## Security Checklist

### For All Platforms

- [ ] Store all tokens in environment variables (not hardcoded)
- [ ] Use HTTPS for all webhook endpoints
- [ ] Implement webhook signature verification
- [ ] Add rate limiting on endpoints
- [ ] Log all API errors and webhooks
- [ ] Rotate tokens annually
- [ ] Use separate dev/staging/prod credentials
- [ ] Implement firewall rules for IP whitelisting
- [ ] Enable two-factor authentication
- [ ] Regular security audits
- [ ] Comply with GDPR/CCPA
- [ ] Document all data access
- [ ] Implement user consent tracking
- [ ] Set up alert for suspicious activity
- [ ] Regular backup of conversation data

---

## Configuration Verification Checklist

### Before Going Live

#### Facebook Messenger
- [ ] App roles assigned correctly
- [ ] Message tags approved
- [ ] Sender display name set
- [ ] Greeting text configured
- [ ] Get started button active
- [ ] Persistent menu set up
- [ ] Quick replies configured
- [ ] Webhook verified and subscribed
- [ ] App domains added
- [ ] Privacy policy linked

#### WhatsApp Business
- [ ] Phone number verified
- [ ] Business profile complete
- [ ] Message templates approved
- [ ] Webhook security enabled
- [ ] Quality rating monitored
- [ ] Conversation settings complete
- [ ] API version tested
- [ ] Rate limits understood
- [ ] Auto-responses configured
- [ ] Opt-in consent tracking

#### Viber Bot
- [ ] Bot settings complete
- [ ] Avatar uploaded
- [ ] Categories set
- [ ] Greeting message set
- [ ] Webhooks subscribed
- [ ] Admin notifications active
- [ ] Error handling tested
- [ ] Rich media templates created
- [ ] Admin email configured
- [ ] Keyboards configured

#### LinkedIn Messaging
- [ ] Company page messaging enabled
- [ ] Messaging team assigned
- [ ] Response settings configured
- [ ] Company profile updated
- [ ] Webhooks verified
- [ ] Privacy settings updated
- [ ] Auto-responses set
- [ ] Analytics tracked
- [ ] Terms accepted
- [ ] Admin permissions set

---

## Quick Configuration Summary

| Platform | Priority Settings | Time to Setup |
|----------|------------------|---------------|
| **Facebook** | Roles, Tags, Menu, Greeting | 30-45 mins |
| **WhatsApp** | Verification, Profile, Templates | 45-60 mins |
| **Viber** | Avatar, Categories, Greeting | 20-30 mins |
| **LinkedIn** | Team, Response, Profile | 25-40 mins |

---

## Environment Variables Template

```env
# ===== FACEBOOK MESSENGER =====
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_WEBHOOK_VERIFY_TOKEN=
FACEBOOK_SENDER_NAME=

# ===== WHATSAPP BUSINESS =====
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_PHONE_NUMBER=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=

# ===== VIBER BOT =====
VIBER_BOT_TOKEN=
VIBER_PUBLIC_KEY=
VIBER_ADMIN_EMAIL=

# ===== LINKEDIN MESSAGING =====
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_ORGANIZATION_ID=
LINKEDIN_WEBHOOK_VERIFY_TOKEN=

# ===== DATABASE =====
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia

# ===== FRONTEND =====
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Resources & Support

- **Facebook Developer Docs**: https://developers.facebook.com/docs/messenger-platform
- **WhatsApp Business API**: https://developers.facebook.com/docs/whatsapp/cloud-api
- **Viber Bot Docs**: https://viber.github.io/docs/
- **LinkedIn Marketing Development**: https://learn.microsoft.com/linkedin/
- **API Rate Limits**: Check each platform's documentation
- **Webhook Testing**: https://webhook.site/ (testing tool)

---

**Last Updated**: February 22, 2026  
**Document Version**: 1.0  
**Status**: Complete

This guide covers ALL platform-specific configurations beyond basic webhook setup!
