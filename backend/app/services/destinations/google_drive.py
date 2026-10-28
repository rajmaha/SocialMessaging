# backend/app/services/destinations/google_drive.py
import json
from typing import List
from app.services.destinations.base import BaseDestination

DEFAULT_FOLDER = "SocialMessaging Backups"
FOLDER_MIME = "application/vnd.google-apps.folder"


class GoogleDriveDestination(BaseDestination):
    """
    Backups in Google Drive, signed in through "Connect Google Drive"
    (see app/services/google_drive_auth.py). With the drive.file scope the app
    reaches only what it created, so a blank folder_id means the app's own
    "SocialMessaging Backups" folder, made on first use.
    """

    def __init__(self, config: dict):
        self.folder_id = (config.get("folder_id") or "").strip()
        self.oauth_token = config.get("oauth_token")  # {"refresh_token", "email"} or its JSON
        self._service = None
        self._resolved_folder = None

    def _token_data(self) -> dict:
        data = self.oauth_token
        if isinstance(data, str):
            try:
                data = json.loads(data) if data.strip() else None
            except ValueError:
                data = None
        if not isinstance(data, dict) or not data.get("refresh_token"):
            raise ValueError(
                "Google Drive is not connected. Press Connect Google Drive and sign in, then try again."
            )
        return data

    def _get_service(self):
        if self._service:
            return self._service
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        token_data = self._token_data()
        client_id = token_data.get("client_id")
        client_secret = token_data.get("client_secret")
        if not client_id or not client_secret:
            from app.services.google_drive_auth import client_credentials
            client_id, client_secret = client_credentials()
        creds = Credentials(
            token=token_data.get("access_token"),
            refresh_token=token_data["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=["https://www.googleapis.com/auth/drive.file"],
        )
        self._service = build("drive", "v3", credentials=creds, cache_discovery=False)
        return self._service

    def _folder(self) -> str:
        """The folder backups go in: the one named, else the app's own (made if missing)."""
        if self._resolved_folder:
            return self._resolved_folder
        service = self._get_service()
        if self.folder_id:
            self._resolved_folder = self.folder_id
            return self.folder_id
        name = DEFAULT_FOLDER.replace("'", "\\'")
        resp = service.files().list(
            q=f"name = '{name}' and mimeType = '{FOLDER_MIME}' and trashed = false",
            fields="files(id)", spaces="drive", pageSize=1,
        ).execute()
        files = resp.get("files", [])
        if files:
            self._resolved_folder = files[0]["id"]
        else:
            made = service.files().create(
                body={"name": DEFAULT_FOLDER, "mimeType": FOLDER_MIME}, fields="id"
            ).execute()
            self._resolved_folder = made["id"]
        return self._resolved_folder

    def _call(self, fn):
        """Run a Drive call, turning Google's errors into a sentence."""
        from google.auth.exceptions import RefreshError
        from googleapiclient.errors import HttpError
        try:
            return fn()
        except RefreshError:
            raise ValueError(
                "Google refused the saved sign-in (it was revoked or has expired). "
                "Press Connect Google Drive again."
            )
        except HttpError as e:
            status = getattr(e.resp, "status", None)
            if status == 404 and self.folder_id:
                raise ValueError(
                    "Folder not found. The app can only use folders it created itself: leave "
                    f"Folder Id blank and it will make \"{DEFAULT_FOLDER}\" in your Drive."
                )
            if status in (401, 403):
                raise ValueError("Google Drive refused access. Press Connect Google Drive again.")
            raise ValueError(f"Google Drive error ({status}).")

    def upload(self, local_path: str, remote_filename: str) -> str:
        from googleapiclient.http import MediaFileUpload

        def go():
            service = self._get_service()
            meta = {"name": remote_filename, "parents": [self._folder()]}
            media = MediaFileUpload(local_path, resumable=True)
            return service.files().create(body=meta, media_body=media, fields="id").execute()

        file = self._call(go)
        return f"gdrive://{file['id']}"

    def delete(self, remote_path: str) -> None:
        file_id = remote_path.replace("gdrive://", "")
        self._call(lambda: self._get_service().files().delete(fileId=file_id).execute())

    def list_backups(self, prefix: str) -> List[str]:
        def go():
            safe = prefix.replace("'", "\\'")
            query = f"'{self._folder()}' in parents and name contains '{safe}' and trashed=false"
            return self._get_service().files().list(q=query, fields="files(id,name)").execute()

        resp = self._call(go)
        return sorted([f"gdrive://{f['id']}" for f in resp.get("files", [])])

    def test_connection(self) -> bool:
        def go():
            meta = self._get_service().files().get(fileId=self._folder(), fields="id,mimeType,trashed").execute()
            if meta.get("mimeType") != FOLDER_MIME:
                raise ValueError("That Folder Id is a file, not a folder.")
            if meta.get("trashed"):
                raise ValueError("That folder is in the Drive trash.")
            return True

        return self._call(go)
