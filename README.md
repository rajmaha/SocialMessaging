# Social Media Messaging System

A unified messaging platform that integrates WhatsApp, Facebook Messenger, Viber, and LinkedIn in one window.

## Project Structure

```
SocialMedia/
├── backend/
│   ├── app/
│   │   ├── models/          # Database models
│   │   ├── routes/          # API endpoints
│   │   ├── services/        # Platform integrations
│   │   ├── schemas/         # Pydantic schemas
│   │   ├── config.py        # Configuration
│   │   └── database.py      # Database setup
│   ├── main.py              # FastAPI entry point
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/                 # Next.js app directory
    ├── components/          # React components
    ├── lib/                 # Utilities and API clients
    ├── public/              # Static assets
    ├── package.json
    ├── tailwind.config.js
    └── postcss.config.js
```

## Features

- **Unified Inbox**: View messages from all platforms in one place
- **Platform Integration**: 
  - WhatsApp Business API
  - Facebook Messenger API
  - Viber API
  - LinkedIn Messaging API
- **Message Management**: Send, receive, and manage messages
- **Platform Filtering**: Filter conversations by platform
- **Search**: Search conversations by contact name
- **Persistent Storage**: All messages stored in PostgreSQL

## Setup Instructions

### Prerequisites
- Python 3.8+
- Node.js 16+
- PostgreSQL 12+

### Backend Setup

1. **Install Python dependencies**:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Setup PostgreSQL**:
   ```bash
   # Create database
   createdb socialmedia
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and database URL
   ```

4. **Run migrations** (creating tables):
   ```bash
   python main.py
   ```

5. **Start the backend server**:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

### Frontend Setup

1. **Install Node dependencies**:
   ```bash
   cd frontend
   npm install
   ```

2. **Create environment file**:
   ```bash
   echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser**:
   Visit `http://localhost:3000`

## API Endpoints

### Conversations
- `GET /conversations/` - Get all conversations
- `GET /conversations/search` - Search conversations
- `PUT /conversations/{id}` - Mark as read
- `DELETE /conversations/{id}` - Archive conversation

### Messages
- `GET /messages/conversation/{id}` - Get conversation messages
- `POST /messages/send` - Send a message
- `PUT /messages/mark-as-read/{id}` - Mark message as read

### Health
- `GET /health` - Health check

## Integrating Platform APIs

### WhatsApp Business API
1. Get API credentials from Meta Developer Console
2. Add to `.env`:
   ```
   WHATSAPP_API_KEY=your_key
   WHATSAPP_PHONE_NUMBER_ID=your_id
   ```

### Facebook Messenger API
1. Create a Facebook App and get access token
2. Add to `.env`:
   ```
   FACEBOOK_ACCESS_TOKEN=your_token
   FACEBOOK_PAGE_ID=your_page_id
   ```

### Viber API
1. Create a Viber Bot and get bot token
2. Add to `.env`:
   ```
   VIBER_BOT_TOKEN=your_token
   ```

### LinkedIn API
1. Create a LinkedIn App and get access token
2. Add to `.env`:
   ```
   LINKEDIN_ACCESS_TOKEN=your_token
   LINKEDIN_ORGANIZATION_ID=your_org_id
   ```

## Building for Production

### Backend
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm run build
npm run start
```

## Documentation

Complete documentation is available:

- **[User Manual](./USER_MANUAL.md)** - Complete guide for all account setup, platform connections, and features
- **[Webhooks & Real-Time Setup](./WEBHOOKS_SETUP.md)** - Detailed guide for 2-way messaging with webhooks for all platforms
- **[Webhooks Quick Reference](./WEBHOOKS_QUICK_REFERENCE.md)** - Quick checklist for webhook setup (print-friendly)
- **[Platform Configuration Guide](./PLATFORM_CONFIGURATION_GUIDE.md)** - All additional platform settings, compliance, and advanced features
- **[Quick Start Guide](./QUICK_START.md)** - 5-minute setup for developers
- **[API Documentation](./API_DOCUMENTATION.md)** - REST API reference and examples
- **[Database Setup](./DATABASE_SETUP.md)** - Database schema and administration
- **[Deployment Guide](./DEPLOYMENT.md)** - Production deployment on various platforms
- **[Project Summary](./PROJECT_SUMMARY.md)** - Project roadmap and technical overview

### For End Users
Start with the [User Manual](./USER_MANUAL.md) for:
- Account creation and login
- Connecting WhatsApp, Facebook, Viber, LinkedIn
- Sending and receiving messages
- Managing accounts
- Troubleshooting common issues

### For Real-Time 2-Way Messaging with Webhooks
See the [Webhooks & Real-Time Setup Guide](./WEBHOOKS_SETUP.md) for comprehensive step-by-step instructions:
- **Facebook Messenger**: Complete setup, credentials, webhook configuration, and testing
- **WhatsApp Business API**: Phone number registration, business account setup, webhook integration
- **Viber Bot**: Bot creation, token management, webhook configuration
- **LinkedIn Messaging**: App creation, OAuth, webhook setup for company pages

Or use the [Webhooks Quick Reference](./WEBHOOKS_QUICK_REFERENCE.md) for:
- Quick checklists for each platform (printable)
- Environment variables template
- Testing commands
- Quick fixes for common issues

### For Platform-Specific Configurations Beyond Webhooks
See the [Platform Configuration Guide](./PLATFORM_CONFIGURATION_GUIDE.md) for:
- **Message tags, templates, and rich media** for each platform
- **Compliance & verification requirements** (GDPR, business registration, opt-in tracking)
- **Team permissions and role management**
- **Analytics and monitoring setup**
- **Advanced features** (broadcast messages, list selection, etc.)
- **Rate limits and optimization** for high-volume messaging
- **Security best practices** for all platforms

### For Developers
Start with the [Quick Start Guide](./QUICK_START.md) for:
- Local development setup
- Running the application
- Understanding the project structure
- Building and deploying

## Development Notes

- All timestamps are in UTC
- Messages are synchronized across platforms
- The system handles multiple user accounts per platform
- Webhook support can be added for real-time message updates

