import requests
import json
from typing import Dict, Any

# Configuration
API_URL = "http://localhost:8000"
HEADERS = {"Content-Type": "application/json"}

class SocialMediaAPI:
    """Python client for Social Media Messaging System API"""
    
    def __init__(self, base_url: str = API_URL):
        self.base_url = base_url
        self.user_id = None
        self.token = None
    
    def register(self, username: str, email: str, password: str, full_name: str) -> Dict[str, Any]:
        """Register a new user"""
        payload = {
            "username": username,
            "email": email,
            "password": password,
            "full_name": full_name
        }
        response = requests.post(f"{self.base_url}/auth/register", json=payload)
        result = response.json()
        
        if response.status_code == 200:
            self.user_id = result.get("user_id")
            print(f"✓ Registered successfully! User ID: {self.user_id}")
        else:
            print(f"✗ Registration failed: {result.get('detail')}")
        
        return result
    
    def login(self, email: str, password: str) -> Dict[str, Any]:
        """Login user"""
        payload = {"email": email, "password": password}
        response = requests.post(f"{self.base_url}/auth/login", json=payload)
        result = response.json()
        
        if response.status_code == 200:
            self.user_id = result.get("user_id")
            print(f"✓ Login successful! User ID: {self.user_id}")
        else:
            print(f"✗ Login failed: {result.get('detail')}")
        
        return result
    
    def add_account(self, platform: str, account_id: str, account_name: str, 
                    access_token: str, phone_number: str = None) -> Dict[str, Any]:
        """Add a platform account"""
        if not self.user_id:
            raise ValueError("Please login first")
        
        payload = {
            "user_id": self.user_id,
            "platform": platform,
            "account_id": account_id,
            "account_name": account_name,
            "access_token": access_token,
            "phone_number": phone_number
        }
        response = requests.post(f"{self.base_url}/accounts/", json=payload)
        result = response.json()
        
        if response.status_code == 200:
            print(f"✓ Account added successfully! Account ID: {result.get('account_id')}")
        else:
            print(f"✗ Failed to add account: {result.get('detail')}")
        
        return result
    
    def get_accounts(self) -> Dict[str, Any]:
        """Get all connected accounts"""
        if not self.user_id:
            raise ValueError("Please login first")
        
        response = requests.get(f"{self.base_url}/accounts/user/{self.user_id}")
        return response.json()
    
    def get_conversations(self, platform: str = None) -> Dict[str, Any]:
        """Get conversations"""
        if not self.user_id:
            raise ValueError("Please login first")
        
        params = {"user_id": self.user_id}
        if platform:
            params["platform"] = platform
        
        response = requests.get(f"{self.base_url}/conversations/", params=params)
        return response.json()
    
    def get_messages(self, conversation_id: int, limit: int = 50) -> Dict[str, Any]:
        """Get messages from a conversation"""
        params = {"limit": limit}
        response = requests.get(
            f"{self.base_url}/messages/conversation/{conversation_id}",
            params=params
        )
        return response.json()
    
    def send_message(self, conversation_id: int, message_text: str,
                    message_type: str = "text", media_url: str = None) -> Dict[str, Any]:
        """Send a message"""
        params = {
            "conversation_id": conversation_id,
            "message_text": message_text,
            "message_type": message_type
        }
        if media_url:
            params["media_url"] = media_url
        
        response = requests.post(f"{self.base_url}/messages/send", params=params)
        result = response.json()
        
        if result.get("success"):
            print(f"✓ Message sent successfully!")
        else:
            print(f"✗ Failed to send message: {result.get('detail')}")
        
        return result
    
    def search_conversations(self, query: str) -> Dict[str, Any]:
        """Search conversations"""
        if not self.user_id:
            raise ValueError("Please login first")
        
        params = {"user_id": self.user_id, "query": query}
        response = requests.get(f"{self.base_url}/conversations/search", params=params)
        return response.json()

# Example usage
if __name__ == "__main__":
    # Initialize client
    api = SocialMediaAPI()
    
    # Register
    # api.register("john_doe", "john@example.com", "password123", "John Doe")
    
    # Login
    api.login("john@example.com", "password123")
    
    # Add WhatsApp account
    # api.add_account("whatsapp", "1234567890", "My Business", "api_key_here", "+1234567890")
    
    # Get conversations
    conversations = api.get_conversations()
    print(f"\nConversations: {json.dumps(conversations, indent=2)}")
    
    # Get messages from first conversation
    if conversations:
        first_conv = conversations[0]
        messages = api.get_messages(first_conv["id"])
        print(f"\nMessages: {json.dumps(messages, indent=2)}")
    
    # Send a message
    # api.send_message(1, "Hello! How are you?")
    
    # Search conversations
    results = api.search_conversations("john")
    print(f"\nSearch Results: {json.dumps(results, indent=2)}")
