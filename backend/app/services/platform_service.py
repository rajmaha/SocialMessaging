"""
Service for handling integrations with different messaging platforms
"""
import httpx
from typing import Optional, Dict, Any
from app.config import settings

class WhatsAppService:
    """WhatsApp Business API Integration"""
    
    BASE_URL = "https://graph.instagram.com/v18.0"
    
    @staticmethod
    async def send_message(phone_number: str, message: str) -> Dict[str, Any]:
        """Send message via WhatsApp"""
        headers = {
            "Authorization": f"Bearer {settings.WHATSAPP_API_KEY}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": phone_number,
            "type": "text",
            "text": {
                "body": message
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WhatsAppService.BASE_URL}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages",
                json=payload,
                headers=headers
            )
            return response.json()

class FacebookService:
    """Facebook Messenger API Integration"""
    
    BASE_URL = "https://graph.instagram.com/v18.0"
    
    @staticmethod
    async def send_message(recipient_id: str, message: str) -> Dict[str, Any]:
        """Send message via Facebook Messenger"""
        headers = {
            "Authorization": f"Bearer {settings.FACEBOOK_ACCESS_TOKEN}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "recipient": {"id": recipient_id},
            "message": {"text": message}
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{FacebookService.BASE_URL}/me/messages",
                json=payload,
                headers=headers
            )
            return response.json()

class ViberService:
    """Viber API Integration"""
    
    BASE_URL = "https://chatapi.viber.com/pa"
    
    @staticmethod
    async def send_message(to: str, text: str) -> Dict[str, Any]:
        """Send message via Viber"""
        headers = {
            "X-Viber-Auth-Token": settings.VIBER_BOT_TOKEN,
            "Content-Type": "application/json"
        }
        
        payload = {
            "receiver": to,
            "min_api_version": 1,
            "sender": {
                "name": "Social Media Manager"
            },
            "type": "text",
            "text": text
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{ViberService.BASE_URL}/send_message",
                json=payload,
                headers=headers
            )
            return response.json()

class LinkedInService:
    """LinkedIn Messaging API Integration"""
    
    BASE_URL = "https://api.linkedin.com/v2"
    
    @staticmethod
    async def send_message(recipient_id: str, message: str) -> Dict[str, Any]:
        """Send message via LinkedIn"""
        headers = {
            "Authorization": f"Bearer {settings.LINKEDIN_ACCESS_TOKEN}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "recipients": [{"memberId": recipient_id}],
            "subject": "",
            "body": message
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{LinkedInService.BASE_URL}/messaging/threads",
                json=payload,
                headers=headers
            )
            return response.json()
