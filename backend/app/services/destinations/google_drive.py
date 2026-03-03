# backend/app/services/destinations/google_drive.py
import os
from typing import List
from app.services.destinations.base import BaseDestination


class GoogleDriveDestination(BaseDestination):
    def __init__(self, config: dict):
        self.folder_id = config.get("folder_id", "root")
        self.oauth_token = config.get("oauth_token")  # JSON string of token dict

    def _get_service(self):
        import json
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        token_data = json.loads(self.oauth_token) if isinstance(self.oauth_token, str) else self.oauth_token
        creds = Credentials(
            token=token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=["https://www.googleapis.com/auth/drive.file"],
        )
        return build("drive", "v3", credentials=creds)

    def upload(self, local_path: str, remote_filename: str) -> str:
        from googleapiclient.http import MediaFileUpload
        service = self._get_service()
        meta = {"name": remote_filename, "parents": [self.folder_id]}
        media = MediaFileUpload(local_path, resumable=True)
        file = service.files().create(body=meta, media_body=media, fields="id").execute()
        return f"gdrive://{file['id']}"

    def delete(self, remote_path: str) -> None:
        file_id = remote_path.replace("gdrive://", "")
        service = self._get_service()
        service.files().delete(fileId=file_id).execute()

    def list_backups(self, prefix: str) -> List[str]:
        service = self._get_service()
        query = f"'{self.folder_id}' in parents and name contains '{prefix}' and trashed=false"
        resp = service.files().list(q=query, fields="files(id,name)").execute()
        return sorted([f"gdrive://{f['id']}" for f in resp.get("files", [])])

    def test_connection(self) -> bool:
        service = self._get_service()
        service.files().get(fileId=self.folder_id).execute()
        return True
