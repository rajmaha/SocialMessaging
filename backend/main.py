from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import Base, engine, SessionLocal
from app.config import settings
from app.routes import messages, conversations, auth, accounts, admin, branding, email, events
from apscheduler.schedulers.background import BackgroundScheduler
from app.services.email_service import email_service
import logging
import os

logger = logging.getLogger(__name__)

# Create tables
Base.metadata.create_all(bind=engine)

# Initialize FastAPI app
app = FastAPI(
    title="Social Media Messaging System",
    description="Unified messaging platform for WhatsApp, Facebook, Viber, and LinkedIn",
    version="1.0.0"
)

# Add CORS middleware (MUST be before routes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
        settings.FRONTEND_URL
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    max_age=3600,
)

# Include routes
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(messages.router)
app.include_router(conversations.router)
app.include_router(admin.router)
app.include_router(branding.router)
app.include_router(email.router)
app.include_router(events.router)

# Serve uploaded avatars
AVATAR_DIR = os.path.join(os.path.dirname(__file__), "avatar_storage")
os.makedirs(AVATAR_DIR, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=AVATAR_DIR), name="avatars")

# Auto-sync scheduler
scheduler = None

def auto_sync_emails():
    """Scheduled task to sync all emails"""
    try:
        db = SessionLocal()
        email_service.sync_all_accounts(db)
        db.close()
    except Exception as e:
        logger.error(f"Error in scheduled email sync: {str(e)}")

@app.on_event("startup")
def startup_event():
    """Initialize background scheduler on startup"""
    global scheduler
    try:
        scheduler = BackgroundScheduler()
        # Run auto-sync every 5 minutes
        scheduler.add_job(auto_sync_emails, 'interval', minutes=5, id='email_auto_sync')
        scheduler.start()
        logger.info("✅ Email auto-sync scheduler started (every 5 minutes)")
    except Exception as e:
        logger.error(f"Error starting scheduler: {str(e)}")

@app.on_event("shutdown")
def shutdown_event():
    """Shutdown scheduler on app shutdown"""
    global scheduler
    if scheduler:
        scheduler.shutdown()
        logger.info("✅ Email auto-sync scheduler stopped")

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "Social Media Messaging System is running"}

@app.get("/")
def root():
    """Root endpoint"""
    return {
        "application": "Social Media Messaging System",
        "version": "1.0.0",
        "docs": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
