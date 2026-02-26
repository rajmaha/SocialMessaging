from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from datetime import datetime
from app.database import Base


class AISettings(Base):
    """Stores the active AI provider config. Only one row ever exists."""
    __tablename__ = "ai_settings"

    id = Column(Integer, primary_key=True, index=True)
    enabled = Column(Boolean, default=False)
    # one of: none | groq | gemini | ollama
    provider = Column(String, default="none")
    api_key = Column(Text, nullable=True)
    model_name = Column(String, nullable=True)
    ollama_url = Column(String, default="http://localhost:11434")
    system_prompt = Column(Text, nullable=True)


class BotSettings(Base):
    __tablename__ = "bot_settings"

    id = Column(Integer, primary_key=True, index=True)
    enabled = Column(Boolean, default=False)
    bot_name = Column(String, default="Support Bot")
    welcome_message = Column(Text, default="👋 Hi! I'm the support bot. How can I help you today?")
    # Message sent when handing off to a human agent
    handoff_message = Column(Text, default="Let me connect you with a human agent. Someone will be with you shortly.")
    # After N unmatched messages, trigger handoff (0 = never auto-handoff)
    handoff_after = Column(Integer, default=3)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BotQA(Base):
    __tablename__ = "bot_qa"

    id = Column(Integer, primary_key=True, index=True)
    # Human-readable question shown as a clickable suggestion button
    question = Column(Text, nullable=True)
    # Comma-separated keywords/phrases that trigger this answer
    keywords = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    order = Column(Integer, default=0)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
