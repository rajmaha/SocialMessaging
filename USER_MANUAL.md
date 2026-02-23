# Social Media Messenger - Complete User Manual

## Table of Contents
1. [Getting Started](#getting-started)
2. [Creating Your Account](#creating-your-account)
3. [Logging In](#logging-in)
4. [Dashboard Overview](#dashboard-overview)
5. [Connecting Platform Accounts](#connecting-platform-accounts)
6. [Sending and Receiving Messages](#sending-and-receiving-messages)
7. [Managing Accounts](#managing-accounts)
8. [Troubleshooting](#troubleshooting)

---

## Getting Started

### System Requirements
- **Web Browser**: Chrome, Firefox, Safari, or Edge (latest version recommended)
- **Internet Connection**: Required for all features
- **Devices**: Available on desktop and tablet browsers

### Access the Application
1. Open your web browser
2. Navigate to: `http://localhost:3000`
3. You will be automatically redirected to the login page if not authenticated

---

## Creating Your Account

### Step 1: Navigate to Registration
1. Go to `http://localhost:3000`
2. You'll see the Login page with two options:
   - "Sign In" (for existing users)
   - "Register Now" (for new users)
3. Click **"Register Now"** tab

### Step 2: Fill Out Registration Form
Complete the following fields:

| Field | Requirements | Example |
|-------|-------------|---------|
| **Full Name** | 2-50 characters | John Smith |
| **Email** | Valid email format | john.smith@example.com |
| **Password** | Minimum 6 characters | SecurePass123! |
| **Confirm Password** | Must match password field | SecurePass123! |

### Step 3: Submit Registration
1. Click the **"Register"** button
2. System validates your information:
   - ✅ Email format is valid
   - ✅ Password is at least 6 characters
   - ✅ Passwords match
   - ✅ Email is not already registered

### Step 4: Automatic Login
After successful registration, you will:
- See a success message: "Registration successful! Logging you in..."
- Be automatically logged in
- Be redirected to the Dashboard within 2 seconds

### Validation Errors
If registration fails, you'll see error messages:
- ❌ "Invalid email format" → Use correct email format (example@domain.com)
- ❌ "Password must be at least 6 characters" → Use longer password
- ❌ "Passwords do not match" → Confirm password matches exactly
- ❌ "Email already registered" → Use different email or login instead

---

## Logging In

### Step 1: Access Login Page
1. Go to `http://localhost:3000`
2. Click the **"Sign In"** tab (if Registration tab is active)
3. You should see the Login form

### Step 2: Enter Credentials
- **Email**: Enter your registered email address
- **Password**: Enter your password

### Step 3: Submit Login
1. Click the **"Sign In"** button
2. Wait for authentication (1-2 seconds)

### Step 4: Access Dashboard
Upon successful login, you'll be:
- Redirected to the Dashboard
- Shown your connected messaging platforms
- Ready to start messaging

### Demo Credentials (For Testing)
If you want to test quickly:
- **Email**: `test@example.com`
- **Password**: `password123`

### Login Troubleshooting
- ❌ "Invalid email or password" → Check credentials and try again
- ❌ "Cannot connect to server" → Ensure backend is running on port 8000
- ❌ "Redirects to login repeatedly" → Clear browser cache and cookies

---

## Dashboard Overview

### Navigation Layout

```
┌─────────────────────────────────────┐
│ SIDEBAR (Left)  │   CHAT AREA (Right) │
├─────────────────────────────────────┤
│ Messages        │                       │
│ (Full Name)     │                       │
│ ⚙️ 🚪 (Icons)  │                       │
│                 │                       │
│ [All] [WhatsApp]│  ← Selected Chat     │
│ [Facebook]      │   Messages Display   │
│ [Viber]         │                      │
│ [LinkedIn]      │                      │
│                 │                      │
│ • Conversation1 │                      │
│ • Conversation2 │                      │
│ • Conversation3 │                      │
├─────────────────────────────────────┤
│ Message Input   │                       │
│ [Type message]  │ [Send Button]        │
└─────────────────────────────────────┘
```

### Dashboard Components

#### 1. **Header (Top Left)**
- **"Messages"**: Application title
- Your **Full Name**: Displayed below title
- **Settings Icon (⚙️)**: Click to manage platform accounts
- **Logout Button (🚪)**: Click to sign out

#### 2. **Platform Filter**
Filter conversations by messaging platform:
- **All**: Shows all conversations from all platforms
- **WhatsApp**: Only WhatsApp messages
- **Facebook**: Only Facebook Messenger messages
- **Viber**: Only Viber messages
- **LinkedIn**: Only LinkedIn messages

#### 3. **Conversation List**
Shows your active conversations:
- **Contact Name**: Person you're chatting with
- **Platform Badge**: Colored dot showing platform (🟢 Green: WhatsApp, 🔵 Blue: Facebook, 🟣 Purple: Viber, 🔷 Dark Blue: LinkedIn)
- **Last Message Preview**: First 50 characters of last message
- **Unread Badge**: Red badge with count if unread messages exist
- **Time**: When last message was received

#### 4. **Chat Window (Right)**
Displays selected conversation:
- Full message history
- Message sender/receiver indicators
- Timestamps for each message
- Input field to compose new messages
- Send button

---

## Connecting Platform Accounts

### Accessing Platform Settings

#### Method 1: From Dashboard
1. Click the **Settings icon (⚙️)** in the top-left corner
2. You'll navigate to the Settings page

#### Method 2: From Settings Button
1. In the Dashboard header, click **"Settings"**
2. You'll navigate to the Settings page

### Settings Page Overview

The Settings page has two main sections:

**Profile Section**:
- Shows your Full Name
- Shows your Email
- Read-only (for privacy)

**Connected Accounts Section**:
- Grid showing all 4 messaging platforms
- Connection status for each
- Add/Remove buttons

### Advanced: Setting Up Real-Time 2-Way Messaging

For a complete 2-way conversation experience with real-time message synchronization, you need to:

1. **Configure Webhooks**: Allow your application to receive incoming messages from each platform
2. **Get API Credentials**: Obtain tokens and IDs from each platform's developer console
3. **Enable Message Forwarding**: Set up your application to send responses back to users

**Important**: This requires technical setup with platform developer accounts.

**See Complete Guide**: [Webhooks & Real-Time Setup Guide](./WEBHOOKS_SETUP.md)

This advanced guide includes:
- Step-by-step webhook configuration for Facebook, WhatsApp, Viber, LinkedIn
- Getting API credentials and tokens
- Backend webhook handler implementation
- Testing and validation procedures
- Troubleshooting webhook issues

---

## Connecting Individual Platform Accounts

### WhatsApp Setup

#### Prerequisites
- Active WhatsApp account
- Phone number associated with WhatsApp
- Phone number with country code (e.g., +1 for US)

#### Steps
1. Go to **Settings** page
2. Find **WhatsApp** card (💬 icon)
3. Click **"Add"** button
4. Fill out the form:
   - **Account ID / Phone Number**: `+1234567890` (with country code)
   - **Display Name / Username**: `John Smith` (how you appear to contacts)
   - **API Key / Access Token**: Leave empty (optional for now)
5. Click **"Save Account"**
6. Confirmation: "WhatsApp account added successfully!"
7. Card now shows:
   - Status: "Connected" with @username
   - Connected date
   - **"Remove"** button to disconnect

#### Valid WhatsApp Formats
✅ +1 (555) 123-4567  
✅ +1-555-123-4567  
✅ +15551234567  
✅ 1-555-123-4567

---

### Facebook Messenger Setup

#### Prerequisites
- Active Facebook account
- Facebook Messenger access enabled
- Facebook username or user ID

#### Steps
1. Go to **Settings** page
2. Find **Facebook Messenger** card (👤 icon)
3. Click **"Add"** button
4. Fill out the form:
   - **Account ID / Phone Number**: Your Facebook username or ID (e.g., `john.smith.123` or `123456789`)
   - **Display Name / Username**: `John Smith` (your Facebook name)
   - **API Key / Access Token**: Leave empty (optional for now)
5. Click **"Save Account"**
6. Confirmation: "Facebook Messenger account added successfully!"
7. Card now shows connection status

#### Finding Your Facebook Information
| Item | How to Find |
|------|------------|
| Username | Facebook Profile → About → Username |
| User ID | facebook.com/your-username → URL shows ID |
| Display Name | Your full name on Facebook profile |

#### Valid Facebook Formats
✅ john.smith.123  
✅ johnsmith  
✅ 123456789 (User ID)  
✅ john@example.com (if linked to email)

---

### Viber Setup

#### Prerequisites
- Active Viber account
- Viber phone number
- Phone number with country code

#### Steps
1. Go to **Settings** page
2. Find **Viber** card (📞 icon)
3. Click **"Add"** button
4. Fill out the form:
   - **Account ID / Phone Number**: Your Viber phone number (e.g., `+1234567890`)
   - **Display Name / Username**: `John Smith` (your Viber display name)
   - **API Key / Access Token**: Leave empty (optional for now)
5. Click **"Save Account"**
6. Confirmation: "Viber account added successfully!"

#### Valid Viber Phone Formats
✅ +1 234 567 8900  
✅ +1-234-567-8900  
✅ +12345678900  
✅ (234) 567-8900

---

### LinkedIn Setup

#### Prerequisites
- Active LinkedIn account
- LinkedIn profile URL or email
- Account verification

#### Steps
1. Go to **Settings** page
2. Find **LinkedIn** card (💼 icon)
3. Click **"Add"** button
4. Fill out the form:
   - **Account ID / Phone Number**: LinkedIn username or email (e.g., `john.smith` or `john@example.com`)
   - **Display Name / Username**: Your professional name (e.g., `John Smith`)
   - **API Key / Access Token**: Leave empty (optional for now)
5. Click **"Save Account"**
6. Confirmation: "LinkedIn account added successfully!"

#### Finding Your LinkedIn Information
| Item | How to Find |
|------|-----------|
| Username | LinkedIn Profile URL: linkedin.com/in/your-username |
| Display Name | Your name on LinkedIn profile |
| Email | Associated email on LinkedIn |

#### Valid LinkedIn Formats
✅ john.smith  
✅ john-smith-123  
✅ john@example.com  
✅ /in/john-smith-123

---

## Managing Accounts

### View All Connected Accounts

1. Go to **Settings** page
2. See **Connected Accounts** section
3. Each connected account shows:
   - Platform name and icon
   - Display name / username
   - Connection date (e.g., "Connected since 2/22/2026")
   - Status badge

### Remove an Account

#### Steps
1. Go to **Settings** page
2. Find the connected account you want to remove
3. Click **"Remove"** button
4. Confirmation dialog appears: "Are you sure you want to remove this account?"
5. Click **"OK"** to confirm or **"Cancel"** to abort
6. Success message: "Account removed successfully!"
7. Card reverts to "Not connected" state

####⚠️ Warnings
- Removing an account does NOT delete message history
- You can re-add the same account anytime
- Contacts will still see you in their conversations

### Update Account Information

#### Current Behavior
- Directly updating account information is not yet available
- To change account details: Remove and re-add the account

#### Planned Feature
- Edit button (coming in future update)
- Update display name without removing account
- Change API keys/access tokens

---

## Sending and Receiving Messages

### Viewing Conversations

1. **From Dashboard**, conversations appear in the **left sidebar**
2. Click any conversation to open it in the **right chat window**
3. See full message history in chronological order

### Filtering Conversations

1. Click platform filter buttons:
   - **All**: Show all conversations
   - **WhatsApp**: Show only WhatsApp chats
   - **Facebook**: Show only Messenger chats
   - **Viber**: Show only Viber chats
   - **LinkedIn**: Show only LinkedIn messages

2. Conversation list updates instantly

### Sending a Message

1. Select a conversation from the left sidebar
2. Click in the **message input field** at the bottom
3. Type your message
4. Click the **Send button** (or press Enter/Cmd+Enter)
5. Message appears in chat window
6. Notification shows delivery status

### Receiving Messages

Messages appear in real-time when:
- Receiver opens the conversation
- Message appears from the sender
- Unread count updates in conversation list
- Red badge shows number of unread messages

### Message Status

| Status | Meaning |
|--------|---------|
| 📤 Sent | Message sent to server |
| ✓ Delivered | Message received by platform |
| ✓✓ Read | Recipient has read message |
| ⏳ Pending | Message is sending |
| ❌ Failed | Message failed to send |

---

## Troubleshooting

### Account Creation Issues

| Problem | Solution |
|---------|----------|
| "Email already registered" | Use a different email address |
| "Invalid email format" | Use format: name@domain.com |
| "Passwords do not match" | Ensure both password fields are identical |
| "Password too short" | Use at least 6 characters |
| Cannot create account | Ensure backend is running and database is connected |

### Login Issues

| Problem | Solution |
|---------|----------|
| "Invalid email or password" | Check credentials - they're case-sensitive |
| Stuck on login page | Clear cache: Ctrl+Shift+Delete (or Cmd+Shift+Delete on Mac) |
| "Cannot connect to server" | Verify backend is running on port 8000 |
| Auto-logs out frequently | Check browser cookie settings |

### Platform Account Issues

| Problem | Solution |
|---------|----------|
| "Account already exists" | That account is already connected, remove first to re-add |
| Cannot add WhatsApp | Use phone with country code: +1 234 567 8900 |
| Cannot add Facebook | Verify username/ID is correct and account is public |
| Cannot add Viber | Ensure phone number is valid and registered in Viber |
| Cannot add LinkedIn | Use correct LinkedIn username from your profile URL |
| Added account not showing | Refresh page (Ctrl+R or Cmd+R) |

### Dashboard Issues

| Problem | Solution |
|---------|----------|
| No conversations appearing | Connect a platform account first |
| Messages not showing | Ensure conversation is selected in left sidebar |
| Filter not working | Refresh page and try again |
| Settings button not responding | Try clicking the gear icon instead |

### General Issues

| Problem | Solution |
|---------|----------|
| "Loading..." stuck | Refresh page (Ctrl+R) |
| Chat won't load | Check internet connection |
| Error messages appearing | Note the message and restart application |
| Buttons not responding | Browser may be outdated - update your browser |

---

## Tips & Best Practices

### ✅ Do's
- ✅ Use your real name in display settings for better identification
- ✅ Add all messaging platforms to see all conversations in one place
- ✅ Check the platform badges to know which service each message comes from
- ✅ Remove accounts you no longer use
- ✅ Keep your password secure and don't share it

### ❌ Don'ts
- ❌ Share your login credentials with anyone
- ❌ Use weak passwords (less than 8 characters recommended)
- ❌ Leave sensitive information in message history
- ❌ Add multiple accounts for the same platform (system prevents this)
- ❌ Forget to logout on shared computers

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Enter** | Send message (in chat window) |
| **Ctrl+R** | Refresh page (any browser) |
| **Cmd+R** | Refresh page (Mac) |
| **Ctrl+Shift+Del** | Open browser cache/cookies (Windows/Linux) |
| **Cmd+Shift+Del** | Open browser cache/cookies (Mac) |

---

## Account Recovery

### Forgot Password
Currently not implemented. To recover access:
1. Register a new account with different email
2. Contact administrator with proof of identity

**Planned Feature**: Password reset link via email (coming soon)

### Account Deactivation
To deactivate your account:
1. Go to **Settings**
2. Look for **"Deactivate Account"** button (planned feature)
3. Confirm deletion
4. Account data will be archived

---

## GDPR & Privacy

### Your Data
- Stored securely on our servers
- Never shared with third parties
- Your messaging platforms are not contacted
- Message history accessible only by you

### Data Access
1. Go to **Settings** page
2. Your profile information is visible
3. Download all your data (planned feature)

### Data Deletion
To delete your account and all data:
1. Requesting via Settings → Delete Account (coming soon)
2. 30-day grace period before permanent deletion
3. Contact admin to expedite

---

## Frequently Asked Questions (FAQ)

**Q: Can I connect the same WhatsApp account twice?**  
A: No, the system prevents duplicate accounts for the same platform.

**Q: Are my messages encrypted?**  
A: Messages are encrypted in transit (HTTPS). End-to-end encryption coming soon.

**Q: Can I access my account from multiple devices?**  
A: Yes, login from any device with your email and password.

**Q: What if I forget my password?**  
A: Password reset feature coming soon. Currently register a new account.

**Q: Can I change my email after registration?**  
A: Not currently. This feature is planned for future releases.

**Q: How many platform accounts can I connect?**  
A: Up to one account per platform (WhatsApp, Facebook, Viber, LinkedIn).

**Q: Are conversations automatically synced?**  
A: Not yet. This feature is in development - manual refresh available now.

**Q: Can I send scheduled messages?**  
A: Not yet. This feature is planned for a future update.

**Q: Is real-time messaging supported?**  
A: Yes, with slight delay. Full real-time via WebSocket coming soon.

---

## Getting Help

### Support Channels
- **Documentation**: Review this manual
- **Troubleshooting**: Check troubleshooting section above
- **Email**: support@socialmediamessenger.local
- **Issues**: Report bugs at [GitHub Issues]

### Providing Feedback
Help us improve! Share your ideas:
- Suggest new features
- Report bugs
- Share your experience
- Rate the application

---

## Version Information

- **Application Version**: 1.0.0
- **Last Updated**: February 22, 2026
- **Browser Compatibility**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Operating Systems**: Windows, macOS, Linux

---

## Additional Resources

- [Quick Start Guide](./QUICK_START.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Database Schema](./DATABASE_SETUP.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Project Timeline](./PROJECT_SUMMARY.md)

---

**Last Updated**: February 22, 2026  
**Document Version**: 1.0  
**Status**: Final Release

For the latest updates and features, visit the application Settings page.
