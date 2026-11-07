"""
Service for handling integrations with different messaging platforms
"""
import logging
import httpx
from typing import Optional, Dict, Any, Tuple
from app.config import settings

logger = logging.getLogger(__name__)

class WhatsAppService:
    """WhatsApp Business API Integration"""

    BASE_URL = "https://graph.facebook.com/v18.0"

    # Refuse anything larger than this rather than pulling it into memory.
    MAX_MEDIA_BYTES = 25 * 1024 * 1024

    @staticmethod
    async def download_media(
        media_id: str,
        access_token: str = None,
    ) -> Optional[Tuple[bytes, str]]:
        """Fetch an inbound media file. Returns (content, mime_type), or None.

        An inbound Cloud API message carries only a media *id*. Turning that
        into bytes takes two calls -- id -> temporary URL, then the URL itself
        -- and the bearer token is required on both, because that URL is not
        public and expires. Returns None on any failure so the caller can fall
        back to a text placeholder rather than dropping the message.
        """
        token = access_token or settings.WHATSAPP_API_KEY
        if not token or not media_id:
            return None

        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                meta = await client.get(
                    f"{WhatsAppService.BASE_URL}/{media_id}", headers=headers
                )
                meta.raise_for_status()
                info = meta.json()

                url = info.get("url")
                if not url:
                    logger.warning("WhatsApp media %s has no url", media_id)
                    return None

                size = int(info.get("file_size") or 0)
                if size > WhatsAppService.MAX_MEDIA_BYTES:
                    logger.warning(
                        "WhatsApp media %s is %d bytes, over the limit", media_id, size
                    )
                    return None

                binary = await client.get(url, headers=headers)
                binary.raise_for_status()
                if len(binary.content) > WhatsAppService.MAX_MEDIA_BYTES:
                    return None
                return binary.content, info.get("mime_type") or ""
        except Exception as e:
            logger.warning("WhatsApp media %s download failed: %s", media_id, e)
            return None

    @staticmethod
    async def send_message(
        phone_number: str,
        message: str,
        access_token: str = None,
        phone_number_id: str = None,
    ) -> Dict[str, Any]:
        """Send message via WhatsApp"""
        token = access_token or settings.WHATSAPP_API_KEY
        pnid = phone_number_id or settings.WHATSAPP_PHONE_NUMBER_ID
        headers = {
            "Authorization": f"Bearer {token}",
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
                f"{WhatsAppService.BASE_URL}/{pnid}/messages",
                json=payload,
                headers=headers
            )
            return response.json()

class WhatsAppTestService:
    BASE_URL = "https://graph.facebook.com/v18.0"

    @staticmethod
    async def test_connection(access_token: str, phone_number_id: str, business_account_id: str = None) -> dict:
        result = {
            "credential_ok": False,
            "credential_detail": "",
            "webhook_status": "unknown",
            "webhook_detail": ""
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                # 1. Credential probe
                cred_resp = await client.get(
                    f"{WhatsAppTestService.BASE_URL}/{phone_number_id}",
                    params={"access_token": access_token, "fields": "display_phone_number,verified_name"}
                )
                if cred_resp.status_code != 200:
                    try:
                        err = cred_resp.json()
                        result["credential_detail"] = err.get("error", {}).get("message", "Invalid credentials")
                    except Exception:
                        result["credential_detail"] = f"HTTP {cred_resp.status_code}: Invalid credentials"
                    return result
                cred_data = cred_resp.json()
                if "error" in cred_data:
                    result["credential_detail"] = cred_data["error"].get("message", "Invalid credentials")
                    return result
                result["credential_ok"] = True
                name = cred_data.get("verified_name") or cred_data.get("display_phone_number", "")
                result["credential_detail"] = f"Connected as: {name}"

                # 2. Webhook check — requires WABA ID, not phone number ID
                if not business_account_id:
                    result["webhook_status"] = "unknown"
                    result["webhook_detail"] = "Enter Business Account ID to check webhook status"
                else:
                    hook_resp = await client.get(
                        f"{WhatsAppTestService.BASE_URL}/{business_account_id}/subscribed_apps",
                        params={"access_token": access_token}
                    )
                    hook_data = hook_resp.json()
                    if "error" in hook_data:
                        result["webhook_status"] = "not_registered"
                        result["webhook_detail"] = hook_data["error"].get("message", "Webhook not registered")
                    else:
                        data = hook_data.get("data", [])
                        if data:
                            fields = ", ".join(data[0].get("subscribed_fields", []))
                            result["webhook_status"] = "registered"
                            result["webhook_detail"] = f"Subscribed to: {fields}" if fields else "Webhook registered"
                        else:
                            result["webhook_status"] = "not_registered"
                            result["webhook_detail"] = "No webhook subscription found"
        except Exception as e:
            result["credential_detail"] = f"Connection error: {str(e)}"
        return result


class FacebookService:
    """Facebook Messenger API Integration"""

    BASE_URL = "https://graph.facebook.com/v18.0"

    @staticmethod
    async def send_message(recipient_id: str, message: str, access_token: str = None) -> Dict[str, Any]:
        """Send message via Facebook Messenger"""
        token = access_token or settings.FACEBOOK_ACCESS_TOKEN
        headers = {
            "Authorization": f"Bearer {token}",
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

class FacebookTestService:
    BASE_URL = "https://graph.facebook.com/v18.0"

    @staticmethod
    async def test_connection(access_token: str, page_id: str) -> dict:
        result = {
            "credential_ok": False,
            "credential_detail": "",
            "webhook_status": "unknown",
            "webhook_detail": ""
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                # 1. Credential probe
                cred_resp = await client.get(
                    f"{FacebookTestService.BASE_URL}/{page_id}",
                    params={"access_token": access_token, "fields": "name,id"}
                )
                if cred_resp.status_code != 200:
                    try:
                        err = cred_resp.json()
                        result["credential_detail"] = err.get("error", {}).get("message", "Invalid credentials")
                    except Exception:
                        result["credential_detail"] = f"HTTP {cred_resp.status_code}: Invalid credentials"
                    return result
                cred_data = cred_resp.json()
                if "error" in cred_data:
                    result["credential_detail"] = cred_data["error"].get("message", "Invalid credentials")
                    return result
                result["credential_ok"] = True
                result["credential_detail"] = f"Connected as: {cred_data.get('name', page_id)}"

                # 2. Webhook check
                hook_resp = await client.get(
                    f"{FacebookTestService.BASE_URL}/{page_id}/subscribed_apps",
                    params={"access_token": access_token}
                )
                hook_data = hook_resp.json()
                if "error" in hook_data:
                    result["webhook_status"] = "not_registered"
                    result["webhook_detail"] = hook_data["error"].get("message", "Webhook not registered")
                else:
                    data = hook_data.get("data", [])
                    if data:
                        fields = ", ".join(data[0].get("subscribed_fields", []))
                        result["webhook_status"] = "registered"
                        result["webhook_detail"] = f"Subscribed to: {fields}" if fields else "Webhook registered"
                    else:
                        result["webhook_status"] = "not_registered"
                        result["webhook_detail"] = "No webhook subscription found"
        except Exception as e:
            result["credential_detail"] = f"Connection error: {str(e)}"
        return result


class ViberService:
    """Viber API Integration"""
    
    BASE_URL = "https://chatapi.viber.com/pa"
    
    @staticmethod
    async def send_message(to: str, text: str, bot_token: str = None) -> Dict[str, Any]:
        """Send message via Viber"""
        token = bot_token or settings.VIBER_BOT_TOKEN
        headers = {
            "X-Viber-Auth-Token": token,
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

class ViberTestService:
    BASE_URL = "https://chatapi.viber.com/pa"

    @staticmethod
    async def test_connection(access_token: str) -> dict:
        result = {
            "credential_ok": False,
            "credential_detail": "",
            "webhook_status": "unknown",
            "webhook_detail": ""
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{ViberTestService.BASE_URL}/get_account_info",
                    headers={"X-Viber-Auth-Token": access_token, "Content-Type": "application/json"},
                    json={}
                )
                data = resp.json()
                status_code = data.get("status", -1)
                if status_code != 0:
                    result["credential_detail"] = data.get("status_message", "Invalid token")
                    return result
                result["credential_ok"] = True
                result["credential_detail"] = f"Connected as: {data.get('name', 'Viber Bot')}"
                webhook = data.get("webhook", "")
                if webhook:
                    result["webhook_status"] = "registered"
                    result["webhook_detail"] = f"Webhook: {webhook}"
                else:
                    result["webhook_status"] = "not_registered"
                    result["webhook_detail"] = "No webhook URL registered"
        except Exception as e:
            result["credential_detail"] = f"Connection error: {str(e)}"
        return result


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


class LinkedInTestService:
    BASE_URL = "https://api.linkedin.com/v2"

    @staticmethod
    async def test_connection(access_token: str) -> dict:
        result = {
            "credential_ok": False,
            "credential_detail": "",
            "webhook_status": "unknown",
            "webhook_detail": "LinkedIn does not support programmatic webhook status checks"
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{LinkedInTestService.BASE_URL}/me",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                data = resp.json()
                if resp.status_code != 200:
                    msg = data.get("message") or data.get("serviceErrorCode") or "Invalid access token"
                    result["credential_detail"] = str(msg)
                    return result
                result["credential_ok"] = True
                first = data.get("localizedFirstName") or ""
                last = data.get("localizedLastName") or ""
                result["credential_detail"] = f"Connected as: {first} {last}".strip() or "LinkedIn account"
        except Exception as e:
            result["credential_detail"] = f"Connection error: {str(e)}"
        return result
