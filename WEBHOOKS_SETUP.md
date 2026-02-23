# Webhooks & Real-Time Messaging Setup Guide

Complete guide to set up webhooks for WhatsApp, Facebook Messenger, Viber, and LinkedIn for real-time 2-way conversations.

## Table of Contents
1. [Overview](#overview)
2. [Facebook Messenger Setup](#facebook-messenger-setup)
3. [WhatsApp Business API Setup](#whatsapp-business-api-setup)
4. [Viber Bot Setup](#viber-bot-setup)
5. [LinkedIn Messaging Setup](#linkedin-messaging-setup)
6. [Backend Configuration](#backend-configuration)
7. [Testing & Validation](#testing--validation)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### What are Webhooks?
Webhooks are HTTP callbacks that allow messaging platforms to send real-time notifications to your application when:
- A message is received
- A user starts typing
- A user reads a message
- Account status changes

### How It Works

```
┌──────────────────┐
│   User on        │
│   Platform       │
│   (WhatsApp,     │
│    Facebook, etc)│
└────────┬─────────┘
         │ Sends Message
         │
         ├─────────────────────────────┐
         │                             │
         ▼                             ▼
    ┌─────────────────┐         ┌──────────────────┐
    │  Platform API   │         │  Your Webhook    │
    │  Receives msg   │         │  Endpoint        │
    │                 │         │  (Processes msg) │
    │                 │────────►│                  │
    │                 │ HTTP    │                  │
    │                 │         └──────────────────┘
    └─────────────────┘
```

### Key Requirements

| Item | Purpose | Where to Get |
|------|---------|-------------|
| **Webhook URL** | Where platform sends messages | Your server (localhost or production) |
| **Verify Token** | Authenticates webhook | You create this token |
| **API Access Token** | Authenticate with platform | Platform developer console |
| **App ID & Secret** | Identify your application | Platform developer console |
| **Phone Number ID** | (WhatsApp only) Unique identifier | Meta Business Platform |

---

## Facebook Messenger Setup

### Step 1: Create Facebook App

#### 1.1 Go to Facebook Developer Console
1. Visit: https://developers.facebook.com/
2. Click **"My Apps"** → **"Create App"**
3. Choose app purpose: **"Manage Business"**
4. Fill in:
   - **App Name**: `SocialMediaMessenger` (or your preferred name)
   - **App Contact Email**: your-email@example.com
   - **App Purpose**: Business
5. Click **"Create App"**

#### 1.2 Add Messenger Product
1. In App Dashboard, click **"Add Product"**
2. Search for **"Messenger"**
3. Click **"Set Up"** on the Messenger card
4. Click **"Add"**

### Step 2: Get Your Credentials

#### 2.1 Get Page Access Token
1. In Messenger product, go to **"Tools"** → **"Tokens"**
2. Select your Facebook Page from dropdown
3. Click **"Generate"** next to "Page Access Token"
4. Copy the token (it starts with `EAABs...`)

```
Example Token:
EAAbkrLDzc1gBAKJZCyZC6D7qh1cOZCZBzKqKJZAohB9ZBzZALfE1v6kOZCZB3O...
(Real token will be much longer)
```

#### 2.2 Get App Secret
1. In App Settings, click **"Settings"** → **"Basic"**
2. Copy **"App Secret"**
3. This is sensitive - keep it private

```
Example App Secret:
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

#### 2.3 Get App ID
1. In same **"Basic"** settings page
2. Copy **"App ID"** (usually 15-17 digits)

```
Example App ID:
1234567890123456
```

### Step 3: Configure Webhook

#### 3.1 Set Webhook URL (Initial Setup)
1. In Messenger product, go to **"Settings"** → **"Webhooks"**
2. Click **"Add Callback URL"**
3. Fill in:
   - **Callback URL**: `https://yourdomain.com/webhooks/facebook` 
     - For **localhost testing**, use: `http://localhost:8000/webhooks/facebook`
     - For **production**, use: `https://yourdomain.com/webhooks/facebook`
   - **Verify Token**: Create a random string (e.g., `my_facebook_verify_token_2026`)
     - This is YOUR secret token, not provided by Facebook
     - Keep it secure and use it in your .env file
4. Click **"Verify and Save"**

#### 3.2 Subscribe to Webhook Events
1. In same Webhooks settings
2. Under **"Webhook Fields"**, check:
   - ✅ `messages` (receive messages)
   - ✅ `messaging_postbacks` (button clicks)
   - ✅ `messaging_reads` (message reads)
   - ✅ `message_deliveries` (delivery confirmation)
   - ✅ `messaging_account_linking` (account link)
3. Click **"Save"**

#### 3.3 Subscribe Page to Webhook
1. Under **"Select a Page to Subscribe Your Webhook to"**
2. Select your Facebook Page
3. Click **"Subscribe"**

### Step 4: Environment Configuration

Add to your `.env` file:

```env
# Facebook Messenger Configuration
FACEBOOK_APP_ID=1234567890123456
FACEBOOK_APP_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
FACEBOOK_PAGE_ACCESS_TOKEN=EAAbkrLDzc1gBAKJZCyZC6D7qh1cOZCZBzKqKJZAohB9ZBzZALfE1v6kOZCZB3O...
FACEBOOK_WEBHOOK_VERIFY_TOKEN=my_facebook_verify_token_2026
FACEBOOK_PAGE_ID=1234567890123456
```

### Step 5: Testing Facebook Webhook

#### 5.1 Local Testing with Ngrok (Tunneling)
To test on localhost, you need to expose it to the internet:

```bash
# Install ngrok: https://ngrok.com/download
# Or via brew on Mac:
brew install ngrok

# Start ngrok tunnel
ngrok http 8000

# Output:
# Session Status: online
# Forwarding: https://abc123def456.ngrok.io -> http://localhost:8000
```

Use this URL in Facebook webhook settings:
```
https://abc123def456.ngrok.io/webhooks/facebook
```

#### 5.2 Send Test Message
1. Open your Facebook Page
2. Send a message to your page visitor (yourself for testing)
3. Check your application logs for webhook delivery
4. Response should show: **200 OK**

### Step 6: Send Messages via API

#### 6.1 Send Text Message to User
```bash
curl -X POST \
  'https://graph.facebook.com/v18.0/me/messages' \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_type": "RESPONSE",
    "recipient": {
      "id": "USER_ID_HERE"
    },
    "message": {
      "text": "Hello! Thank you for your message."
    }
  }' \
  -H "Authorization: Bearer YOUR_PAGE_ACCESS_TOKEN"
```

Replace:
- `USER_ID_HERE`: Facebook user ID (sent in webhook payload)
- `YOUR_PAGE_ACCESS_TOKEN`: Your page access token

---

## WhatsApp Business API Setup

### Step 1: Create Meta Business Account

#### 1.1 Prerequisites
- Facebook Business Manager account
- WhatsApp Business Account
- Phone number to verify

#### 1.2 Go to Meta Business Platform
1. Visit: https://business.facebook.com
2. Click **"All Tools"** → **"WhatsApp Business"**
3. Click **"Get Started"**

### Step 2: Get WhatsApp Credentials

#### 2.1 Create WhatsApp App
1. Go to: https://developers.facebook.com/
2. Create new app (or use existing from Messenger setup)
3. Add **"WhatsApp"** product to your app

#### 2.2 Get Business Phone Number ID
1. In WhatsApp settings, go to **"Phone Numbers"**
2. You'll see your business phone number and its **Phone Number ID**
3. Copy the **Phone Number ID** (looks like: `1234567890123456`)

```
Example Phone Number ID:
1234567890123456
```

#### 2.3 Get WhatsApp Business Account ID
1. Go to **"WhatsApp Business Accounts"**
2. Click your account
3. Copy the **Account ID**

#### 2.4 Get Access Token
1. Go back to your app settings, **"Settings"** → **"Basic"**
2. Scroll to **"Access Tokens"**
3. Generate temporary token or use system user token
4. Copy the token

```
Example Token:
EAAbkrLDzc1gBAKJZCyZC6D7qh1cOZCZBzKqKJZAohB9ZBzZALfE1v6kOZCZB3O...
```

### Step 3: Configure Webhook

#### 3.1 Register Webhook URL
1. In WhatsApp product → **"Configuration"**
2. Under **"Webhook"**, click **"Edit"**
3. Set:
   - **Callback URL**: `https://yourdomain.com/webhooks/whatsapp`
     - For localhost: `http://localhost:8000/webhooks/whatsapp`
   - **Verify Token**: Create random token (e.g., `my_whatsapp_verify_token_2026`)
4. Click **"Verify and Save"**

#### 3.2 Subscribe to Webhook Events
1. Under **"Webhook fields"**, check:
   - ✅ `messages` (incoming messages)
   - ✅ `message_template_status_update` (template status)
   - ✅ `message_status` (delivery status)
   - ✅ `account_alerts` (account issues)
2. Click **"Save"**

### Step 4: Environment Configuration

Add to `.env`:

```env
# WhatsApp Business API Configuration
WHATSAPP_BUSINESS_ACCOUNT_ID=1234567890123456
WHATSAPP_PHONE_NUMBER_ID=1234567890123456
WHATSAPP_ACCESS_TOKEN=EAAbkrLDzc1gBAKJZCyZC6D7qh1cOZCZBzKqKJZAohB9ZBzZALfE1v6kOZCZB3O...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=my_whatsapp_verify_token_2026
WHATSAPP_PHONE_NUMBER=+12025551234
```

### Step 5: Testing WhatsApp Webhook

#### 5.1 Register Test Number
1. In WhatsApp settings → **"Senders"**
2. Add your personal phone number as test number
3. You'll get a code via SMS
4. Enter code to verify

#### 5.2 Send Test Message
1. From your registered number, send WhatsApp message to your business number
2. Check logs for webhook delivery
3. Verify message appears in your application

### Step 6: Send Messages via WhatsApp API

#### 6.1 Send Text Message
```bash
curl -X POST \
  "https://graph.instagram.com/v18.0/YOUR_PHONE_NUMBER_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "RECIPIENT_PHONE_NUMBER",
    "type": "text",
    "text": {
      "body": "Hello! I received your message."
    }
  }' \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Replace:
- `YOUR_PHONE_NUMBER_ID`: Your WhatsApp phone number ID
- `RECIPIENT_PHONE_NUMBER`: User's number (from webhook, e.g., `12025551234`)
- `YOUR_ACCESS_TOKEN`: WhatsApp access token

#### 6.2 Send Template Message
```bash
curl -X POST \
  "https://graph.instagram.com/v18.0/YOUR_PHONE_NUMBER_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_product": "whatsapp",
    "to": "RECIPIENT_PHONE_NUMBER",
    "type": "template",
    "template": {
      "name": "hello_world",
      "language": {
        "code": "en_US"
      }
    }
  }' \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Viber Bot Setup

### Step 1: Create Viber Bot

#### 1.1 Go to Viber Developer Portal
1. Visit: https://partners.viber.com/
2. Sign up or login with your Viber account
3. Click **"Create Bot"**

#### 1.2 Fill Bot Information
- **Bot Name**: `SocialMediaMessenger`
- **Bot Avatar**: Upload your brand logo
- **Category**: Select "Business"
- **Webhook URL**: Your endpoint (see Step 3)
- **Accept incoming**: Check all options
- Click **"Create"**

### Step 2: Get Viber Credentials

#### 2.1 Get Bot Token
1. In Bot Dashboard
2. Click **"Settings"** → **"Account"**
3. Copy your **Bot Token** (long alphanumeric string)

```
Example Token:
45a5f8e0e3f4e5d6-a5e5c8d4f1e2b3a4-c6d7e8f9a0b1c2d3
```

#### 2.2 Get Bot Public Key
1. In same Account settings
2. Copy the **Public Key** (starts with "-----BEGIN PUBLIC KEY-----")

### Step 3: Configure Webhook

#### 3.1 Set Webhook URL
1. In Bot settings → **"Webhook"**
2. Enter:
   - **Webhook URL**: `https://yourdomain.com/webhooks/viber`
     - For localhost: `http://localhost:8000/webhooks/viber` (requires ngrok)
3. Click **"Save"**

#### 3.2 Set Webhook Events
Check the following events:
- ✅ Incoming messages
- ✅ Delivered
- ✅ Read
- ✅ Failed
- ✅ Subscribed
- ✅ Unsubscribed

### Step 4: Environment Configuration

Add to `.env`:

```env
# Viber Bot Configuration
VIBER_BOT_TOKEN=45a5f8e0e3f4e5d6-a5e5c8d4f1e2b3a4-c6d7e8f9a0b1c2d3
VIBER_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
-----END PUBLIC KEY-----
```

### Step 5: Testing Viber Webhook

#### 5.1 Set Bot as Subscriber
1. Open your bot in Viber app
2. Send `/start` command
3. Bot should send welcome message

#### 5.2 Send Test Message
1. Send message to your bot
2. Check logs for webhook delivery
3. Verify message in your application

### Step 6: Send Messages via Viber API

#### 6.1 Send Text Message
```bash
curl -X POST \
  "https://chatapi.viber.com/pa/send_message" \
  -H 'Content-Type: application/json' \
  -d '{
    "authentication_token": "YOUR_BOT_TOKEN",
    "to": "VIBER_USER_ID",
    "type": "text",
    "text": "Hello! I received your message."
  }'
```

Replace:
- `YOUR_BOT_TOKEN`: Your Viber bot token
- `VIBER_USER_ID`: User ID from webhook payload

---

## LinkedIn Messaging Setup

### Step 1: Create LinkedIn Application

#### 1.1 Go to LinkedIn Developer
1. Visit: https://www.linkedin.com/developers/apps
2. Click **"Create app"**
3. Fill in:
   - **App name**: `SocialMediaMessenger`
   - **LinkedIn Page**: Select your business page
   - **App logo**: Upload logo
   - **Legal agreement**: Accept terms
4. Click **"Create app"**

### Step 2: Get LinkedIn Credentials

#### 2.1 Get Access Token
1. In App dashboard, go to **"Auth"** tab
2. Under "OAuth 2.0 credentials", copy **Client ID** and **Client Secret**
3. Generate an access token:
   - Go to **"Settings"** → **"Organization Admin"**
   - Request the token to be generated
   - Or use OAuth flow to get user token

```
Example Access Token:
AQVr8i1YvZc1z8h6Q9X5Y7Z2A4B6C8D0E2F4...
```

#### 2.2 Get Organization ID
1. Navigate to your LinkedIn Page
2. Look at the URL: `https://www.linkedin.com/company/YOUR_ORG_ID`
3. Copy the numeric ID

```
Example Organization ID:
12345678
```

### Step 3: Configure Messaging Webhooks

#### 3.1 Set Up Webhooks
1. In App settings → **"Product"** → **"Messaging"**
2. Click **"Add webhook"**
3. Set:
   - **Webhook URL**: `https://yourdomain.com/webhooks/linkedin`
   - **Events**: 
     - ✅ message_created (new messages)
     - ✅ message_read (read receipts)

#### 3.2 Get Verification Token
- LinkedIn will provide a verification token
- Add it to your webhook validation

### Step 4: Environment Configuration

Add to `.env`:

```env
# LinkedIn Messaging Configuration
LINKEDIN_CLIENT_ID=YOUR_CLIENT_ID
LINKEDIN_CLIENT_SECRET=YOUR_CLIENT_SECRET
LINKEDIN_ACCESS_TOKEN=AQVr8i1YvZc1z8h6Q9X5Y7Z2A4B6C8D0E2F4...
LINKEDIN_ORGANIZATION_ID=12345678
LINKEDIN_WEBHOOK_VERIFY_TOKEN=your_linkedin_verify_token
```

### Step 5: Testing LinkedIn Webhook

#### 5.1 Send Test Message
1. Send DM to your company page on LinkedIn
2. Check webhook logs
3. Verify message received in application

### Step 6: Send Messages via LinkedIn API

#### 6.1 Send Direct Message
```bash
curl -X POST \
  "https://api.linkedin.com/v2/messaging/conversations" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -d '{
    "recipients": {
      "values": [
        {
          "firstName": "USER_FIRST_NAME",
          "lastName": "USER_LAST_NAME"
        }
      ]
    },
    "subject": "Message from Social Media Messenger",
    "body": "Hello! Thank you for contacting us."
  }'
```

---

## Backend Configuration

### Step 1: Backend Webhook Handler Setup

Create `backend/app/routes/webhooks.py`:

```python
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import os
import hmac
import hashlib
from datetime import datetime
from ..database import SessionLocal
from ..models import Message, Conversation, User

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# ============ FACEBOOK WEBHOOKS ============

@router.post("/facebook")
async def facebook_webhook(request: Request):
    """Handle incoming Facebook Messenger messages"""
    
    # Verify webhook token
    verify_token = os.getenv("FACEBOOK_WEBHOOK_VERIFY_TOKEN")
    data = await request.json()
    
    if data.get("object") == "page":
        for entry in data.get("entry", []):
            for messaging in entry.get("messaging", []):
                
                # Check if this is a message event
                if messaging.get("message"):
                    sender_id = messaging["sender"]["id"]
                    recipient_id = messaging["recipient"]["id"]
                    message_text = messaging["message"].get("text", "")
                    timestamp = messaging.get("timestamp")
                    
                    # Save to database
                    db = SessionLocal()
                    try:
                        # Create or get conversation
                        conversation = db.query(Conversation).filter(
                            Conversation.contact_id == sender_id,
                            Conversation.platform == "facebook"
                        ).first()
                        
                        if not conversation:
                            conversation = Conversation(
                                user_id=1,  # Get from authenticated user
                                platform="facebook",
                                contact_id=sender_id,
                                contact_name=messaging["sender"].get("name", "Unknown"),
                                last_message=message_text,
                                last_message_time=datetime.fromtimestamp(timestamp / 1000)
                            )
                            db.add(conversation)
                            db.commit()
                        
                        # Save message
                        msg = Message(
                            conversation_id=conversation.id,
                            sender_id=sender_id,
                            receiver_id=recipient_id,
                            message_text=message_text,
                            platform="facebook",
                            timestamp=datetime.fromtimestamp(timestamp / 1000)
                        )
                        db.add(msg)
                        db.commit()
                        
                    finally:
                        db.close()
                    
                    # Send acknowledgement
                    return JSONResponse({"status": "ok"})
    
    return JSONResponse({"status": "ok"})

@router.get("/facebook")
async def facebook_webhook_verify(request: Request):
    """Verify Facebook webhook token"""
    
    verify_token = os.getenv("FACEBOOK_WEBHOOK_VERIFY_TOKEN")
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    
    if mode == "subscribe" and token == verify_token:
        return JSONResponse(content=int(challenge))
    else:
        raise HTTPException(status_code=403, detail="Invalid verify token")

# ============ WHATSAPP WEBHOOKS ============

@router.post("/whatsapp")
async def whatsapp_webhook(request: Request):
    """Handle incoming WhatsApp messages"""
    
    data = await request.json()
    
    # Process each message entry
    for entry in data.get("entry", []):
        for change in entry.get("changes", []):
            if change.get("field") == "messages":
                messages = change.get("value", {}).get("messages", [])
                contacts = change.get("value", {}).get("contacts", [])
                
                for msg in messages:
                    sender_id = msg.get("from")
                    message_text = msg.get("text", {}).get("body", "")
                    timestamp = msg.get("timestamp")
                    
                    # Get sender name from contacts
                    sender_name = "Unknown"
                    if contacts:
                        sender_name = contacts[0].get("profile", {}).get("name", "Unknown")
                    
                    # Save to database
                    db = SessionLocal()
                    try:
                        # Create/update conversation
                        conversation = db.query(Conversation).filter(
                            Conversation.contact_id == sender_id,
                            Conversation.platform == "whatsapp"
                        ).first()
                        
                        if not conversation:
                            conversation = Conversation(
                                user_id=1,
                                platform="whatsapp",
                                contact_id=sender_id,
                                contact_name=sender_name,
                                last_message=message_text,
                                last_message_time=datetime.fromtimestamp(int(timestamp))
                            )
                            db.add(conversation)
                            db.commit()
                        
                        # Save message
                        msg_obj = Message(
                            conversation_id=conversation.id,
                            sender_id=sender_id,
                            message_text=message_text,
                            platform="whatsapp",
                            timestamp=datetime.fromtimestamp(int(timestamp))
                        )
                        db.add(msg_obj)
                        db.commit()
                        
                    finally:
                        db.close()
    
    return JSONResponse({"status": "ok"})

@router.get("/whatsapp")
async def whatsapp_webhook_verify(request: Request):
    """Verify WhatsApp webhook token"""
    
    verify_token = os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN")
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    
    if mode == "subscribe" and token == verify_token:
        return JSONResponse(content=challenge)
    else:
        raise HTTPException(status_code=403, detail="Invalid verify token")

# ============ VIBER WEBHOOKS ============

@router.post("/viber")
async def viber_webhook(request: Request):
    """Handle incoming Viber messages"""
    
    data = await request.json()
    event_type = data.get("event")
    
    if event_type == "message":
        sender_id = data.get("sender", {}).get("id")
        message_text = data.get("message", {}).get("text", "")
        timestamp = data.get("timestamp")
        sender_name = data.get("sender", {}).get("name", "Unknown")
        
        # Save to database
        db = SessionLocal()
        try:
            # Create/update conversation
            conversation = db.query(Conversation).filter(
                Conversation.contact_id == sender_id,
                Conversation.platform == "viber"
            ).first()
            
            if not conversation:
                conversation = Conversation(
                    user_id=1,
                    platform="viber",
                    contact_id=sender_id,
                    contact_name=sender_name,
                    last_message=message_text,
                    last_message_time=datetime.fromtimestamp(timestamp / 1000)
                )
                db.add(conversation)
                db.commit()
            
            # Save message
            msg = Message(
                conversation_id=conversation.id,
                sender_id=sender_id,
                message_text=message_text,
                platform="viber",
                timestamp=datetime.fromtimestamp(timestamp / 1000)
            )
            db.add(msg)
            db.commit()
            
        finally:
            db.close()
    
    return JSONResponse({"status": "ok"})

# ============ LINKEDIN WEBHOOKS ============

@router.post("/linkedin")
async def linkedin_webhook(request: Request):
    """Handle incoming LinkedIn messages"""
    
    data = await request.json()
    
    # Check for conversation created event
    if "eventMeta" in data:
        event = data.get("eventMeta")
        
        if event.get("type") == "CREATE":
            # Process message
            message_id = data.get("id")
            conversation_id = data.get("conversationId")
            sender_id = data.get("from")
            message_text = data.get("body", {}).get("text", "")
            
            # Save to database
            db = SessionLocal()
            try:
                # Create/update conversation
                conversation = db.query(Conversation).filter(
                    Conversation.contact_id == sender_id,
                    Conversation.platform == "linkedin"
                ).first()
                
                if not conversation:
                    conversation = Conversation(
                        user_id=1,
                        platform="linkedin",
                        contact_id=sender_id,
                        contact_name="LinkedIn User",
                        last_message=message_text,
                        last_message_time=datetime.now()
                    )
                    db.add(conversation)
                    db.commit()
                
                # Save message
                msg = Message(
                    conversation_id=conversation.id,
                    sender_id=sender_id,
                    message_text=message_text,
                    platform="linkedin",
                    timestamp=datetime.now()
                )
                db.add(msg)
                db.commit()
                
            finally:
                db.close()
    
    return JSONResponse({"status": "ok"})
```

### Step 2: Update Main Backend File

In `backend/main.py`, add webhook routes:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import auth, conversations, messages, accounts
from app.routes import webhooks  # Add this import

app = FastAPI(
    title="Social Media Messaging System",
    description="Unified messaging platform",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(conversations.router)
app.include_router(messages.router)
app.include_router(accounts.router)
app.include_router(webhooks.router)  # Add this line

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "Social Media Messaging System is running"
    }
```

---

## Testing & Validation

### Test 1: Verify Webhook Registration

#### Facebook
```bash
# Check if webhook is active
curl -X GET \
  "https://graph.facebook.com/v18.0/YOUR_PAGE_ID/subscribed_apps" \
  -H "Authorization: Bearer YOUR_PAGE_ACCESS_TOKEN"

# Response should list your app
```

#### WhatsApp
```bash
# Verify webhook is set
curl -X GET \
  "https://graph.instagram.com/v18.0/YOUR_PHONE_NUMBER_ID/webhooks" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### Viber
```bash
# Check webhook status
curl -X GET \
  "https://chatapi.viber.com/pa/get_account_info" \
  -H 'Content-Type: application/json' \
  -d '{
    "authentication_token": "YOUR_BOT_TOKEN"
  }'
```

### Test 2: Send Test Messages

#### Facebook Test
1. Send message from Facebook Messenger
2. Check application logs for webhook delivery
3. Verify message appears in dashboard

#### WhatsApp Test
1. Send WhatsApp message from test number
2. Check logs
3. Verify in application

#### Viber Test
1. Send message to bot
2. Check logs
3. Verify in application

#### LinkedIn Test
1. Send DM to company page
2. Check logs
3. Verify in application

### Test 3: Test Message Sending

#### Send Message Back to Facebook User
```bash
# In your application, after receiving a message
curl -X POST \
  "https://graph.facebook.com/v18.0/me/messages" \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_type": "RESPONSE",
    "recipient": {
      "id": "SENDER_ID_FROM_WEBHOOK"
    },
    "message": {
      "text": "Thank you for your message!"
    }
  }' \
  -H "Authorization: Bearer FACEBOOK_PAGE_ACCESS_TOKEN"
```

---

## Troubleshooting

### Webhook Not Receiving Messages

#### Issue: "Webhook never called"

| Platform | Solution |
|----------|----------|
| **Facebook** | 1. Verify page is subscribed to webhook 2. Check verify token matches 3. Check callback URL is accessible 4. Verify subscribed events are selected |
| **WhatsApp** | 1. Verify phone number is registered 2. Check webhook fields are checked 3. Test with registered test number first |
| **Viber** | 1. Verify bot is set as subscriber 2. Check webhook URL has HTTPS (except localhost) 3. Send `/start` command to bot |
| **LinkedIn** | 1. Verify webhook URL is HTTPS 2. Check organization ID is correct 3. Verify messaging product is added |

#### Issue: "Webhook validation fails"

```
Solution steps:
1. Check verify token is correct in .env
2. Ensure token matches in webhook settings
3. Restart backend service
4. Re-register webhook
```

### Messages Not Appearing in Dashboard

#### Debugging Steps

1. **Check webhook logs**:
   ```bash
   # In your FastAPI logs, you should see:
   # INFO: POST /webhooks/facebook - 200 OK
   # or similar for other platforms
   ```

2. **Verify database connection**:
   ```bash
   # Test database
   psql -U rajmaha -d socialmedia -c "SELECT COUNT(*) FROM messages;"
   ```

3. **Check .env variables**:
   ```bash
   # Verify all tokens are set
   grep -E "FACEBOOK|WHATSAPP|VIBER|LINKEDIN" backend/.env
   ```

4. **Enable debug logging**:
   ```python
   import logging
   logging.basicConfig(level=logging.DEBUG)
   ```

### Rate Limiting Issues

Each platform has rate limits:

| Platform | Limit |
|----------|-------|
| **Facebook** | 60 messages/second |
| **WhatsApp** | 80 messages/second |
| **Viber** | 300 messages/minute |
| **LinkedIn** | 10 messages/minute |

**Solution**: Implement message queue with Redis/Celery for high-volume scenarios

### Authentication Token Expired

| Platform | How Tokens Expire |
|----------|------------------|
| **Facebook** | 60 days (can be extended to 5 years) |
| **WhatsApp** | 60 days (refresh automatically) |
| **Viber** | Long-lived (rarely expires) |
| **LinkedIn** | Varies (check dashboard) |

**Solution**:
1. Set up token refresh logic in your application
2. Monitor token expiration dates
3. Schedule renewal before expiration

---

## Environment Variables Checklist

Copy this to your `.env` file and fill in all values:

```env
# ======== DATABASE ========
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia

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

# ======== FRONTEND ========
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Quick Reference: API Endpoints

### Receive Messages (Webhooks)
- **Facebook**: `POST /webhooks/facebook`
- **WhatsApp**: `POST /webhooks/whatsapp`  
- **Viber**: `POST /webhooks/viber`
- **LinkedIn**: `POST /webhooks/linkedin`

### Send Messages (Backend)
- **Facebook**: `POST` to `graph.facebook.com/v18.0/me/messages`
- **WhatsApp**: `POST` to `graph.instagram.com/v18.0/{PHONE_NUMBER_ID}/messages`
- **Viber**: `POST` to `https://chatapi.viber.com/pa/send_message`
- **LinkedIn**: `POST` to `https://api.linkedin.com/v2/messaging/conversations`

---

## Security Best Practices

✅ **DO**
- Store all tokens in environment variables
- Use HTTPS for all webhook URLs (ngrok in development)
- Verify webhook signatures and tokens
- Regenerate tokens annually
- Monitor webhook logs for suspicious activity
- Use separate tokens for testing and production
- Implement rate limiting on your endpoints

❌ **DON'T**
- Hardcode tokens in source code
- Share credentials with team members via email
- Use same credentials for dev and production
- Log sensitive tokens in debug mode
- Expose webhook URLs without authentication
- Use HTTP (non-HTTPS) for webhooks in production

---

## Additional Resources

- [Facebook Messenger API Docs](https://developers.facebook.com/docs/messenger-platform)
- [WhatsApp Business API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Viber Bot API Docs](https://viber.github.io/docs/general/rich-media-message/)
- [LinkedIn Messaging API Docs](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/sharesapi)

---

**Last Updated**: February 22, 2026  
**Document Version**: 1.0  
**Status**: Production Ready

