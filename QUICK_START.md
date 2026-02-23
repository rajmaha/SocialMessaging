# Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Clone and Initialize (1 min)

```bash
cd /Users/rajmaha/Sites/SocialMedia
chmod +x setup.sh
./setup.sh
```

This will:
- Create Python virtual environment
- Install backend dependencies
- Install frontend dependencies
- Create necessary `.env` files

### Step 2: Setup Database (1 min)

```bash
# Create PostgreSQL database
createdb socialmedia

# Or if you need to specify a user:
createdb socialmedia -U your_username
```

### Step 3: Configure API Keys (2 min)

Edit `backend/.env` with your platform credentials:

```bash
cd backend
nano .env
```

Add your credentials:
```
WHATSAPP_API_KEY=your_key_here
FACEBOOK_ACCESS_TOKEN=your_token_here
VIBER_BOT_TOKEN=your_token_here
LINKEDIN_ACCESS_TOKEN=your_token_here
```

### Step 4: Start the Application (1 min)

```bash
chmod +x start.sh
./start.sh
```

Or manually in separate terminals:

**Terminal 1 - Backend:**
```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

### Step 5: Open in Browser

Visit: **http://localhost:3000**

---

## 📌 Default Credentials (Development Only)

If you navigate to the app, you can:
1. Register a new account
2. Connect your messaging platforms
3. Start messaging!

---

## 🔌 Platform Setup

### WhatsApp
1. Go to [Meta Developer Console](https://developers.facebook.com/)
2. Create an app → WhatsApp Business
3. Get your API key and Phone Number ID
4. Add to `.env`

### Facebook Messenger
1. Create Facebook App in Developer Console
2. Add Messenger Product
3. Get Page Access Token
4. Add to `.env`

### Viber
1. Go to [Viber Developer](https://developers.viber.com/)
2. Create Bot
3. Get Bot Token
4. Add to `.env`

### LinkedIn
1. Go to [LinkedIn Developers](https://www.linkedin.com/developers/)
2. Create App
3. Get Access Token
4. Add to `.env`

---

## 🛠️ Useful Commands

### Backend Commands
```bash
# Install additional packages
pip install package_name

# Run tests
pytest

# Format code
black app/

# Lint code
flake8 app/
```

### Frontend Commands
```bash
# Install additional packages
npm install package_name

# Build for production
npm run build

# Run built version
npm start

# Type check
npm run type-check
```

### Database Commands
```bash
# Connect to database
psql socialmedia

# List tables
\dt

# Backup database
pg_dump socialmedia > backup.sql

# Restore database
psql socialmedia < backup.sql

# Drop database
dropdb socialmedia
```

---

## 📖 Documentation Files

Read these files for more information:

- **[README.md](./README.md)** - Project overview and features
- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - Complete API reference
- **[DATABASE_SETUP.md](./DATABASE_SETUP.md)** - Database configuration guide
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment instructions
- **[GIT_SETUP.md](./GIT_SETUP.md)** - Git workflow guide

---

## 🔗 Important Links

| Resource | URL |
|----------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |
| API Docs (ReDoc) | http://localhost:8000/redoc |
| Health Check | http://localhost:8000/health |

---

## ⚠️ Troubleshooting

### Port Already in Use
```bash
# Kill process using port 3000
lsof -i :3000
kill -9 <PID>

# Kill process using port 8000
lsof -i :8000
kill -9 <PID>
```

### Database Connection Error
```bash
# Check PostgreSQL is running
psql --version

# Start PostgreSQL (macOS)
brew services start postgresql

# Start PostgreSQL (Ubuntu)
sudo systemctl start postgresql
```

### Module Not Found Error
```bash
# Reinstall dependencies
cd backend
source venv/bin/activate
pip install -r requirements.txt

cd ../frontend
npm install
```

### CORS Errors
```
# Make sure backend is running on port 8000
# Clear browser cache
# Check FRONTEND_URL in backend/.env
```

---

## 📝 Next Steps

1. **Customize the UI** - Edit components in `frontend/components/`
2. **Add more platforms** - Extend `backend/app/services/platform_service.py`
3. **Add authentication** - Implement JWT tokens
4. **Deploy** - Follow [DEPLOYMENT.md](./DEPLOYMENT.md)
5. **Setup real-time features** - Add WebSocket support

---

## 🆘 Need Help?

- Check API Docs: http://localhost:8000/docs
- Review [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- Check logs: `docker-compose logs`
- Common issues: See Troubleshooting section

---

## 🎉 You're Ready!

Your Social Media Messaging System is up and running! 

Start connecting your accounts and messaging across all platforms from one unified interface.

Happy coding! 🚀
