# backend/app/services/destinations/onedrive.py
import json
import requests
from typing import List
from app.services.destinations.base import BaseDestination

GRAPH_API = "https://graph.microsoft.com/v1.0"


class OneDriveDestination(BaseDestination):
    def __init__(self, config: dict):
        self.folder_path = config.get("folder_path", "/backups")
        self.oauth_token = config.get("oauth_token")  # JSON string

    def _get_token(self) -> str:
        token_data = json.loads(self.oauth_token) if isinstance(self.oauth_token, str) else self.oauth_token
        return token_data["access_token"]

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._get_token()}"}

    def upload(self, local_path: str, remote_filename: str) -> str:
        remote = f"{self.folder_path}/{remote_filename}"
        url = f"{GRAPH_API}/me/drive/root:{remote}:/content"
        with open(local_path, "rb") as f:
            resp = requests.put(url, headers={**self._headers(), "Content-Type": "application/octet-stream"}, data=f)
        resp.raise_for_status()
        item_id = resp.json()["id"]
        return f"onedrive://{item_id}"

    def delete(self, remote_path: str) -> None:
        item_id = remote_path.replace("onedrive://", "")
        url = f"{GRAPH_API}/me/drive/items/{item_id}"
        resp = requests.delete(url, headers=self._headers())
        resp.raise_for_status()

    def list_backups(self, prefix: str) -> List[str]:
        url = f"{GRAPH_API}/me/drive/root:{self.folder_path}:/children"
        resp = requests.get(url, headers=self._headers())
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        items = resp.json().get("value", [])
        return sorted([f"onedrive://{i['id']}" for i in items if i["name"].startswith(prefix)])

    def test_connection(self) -> bool:
        url = f"{GRAPH_API}/me/drive"
        resp = requests.get(url, headers=self._headers())
        resp.raise_for_status()
        return True
