# backend/app/services/destinations/base.py
from abc import ABC, abstractmethod
from typing import List


class BaseDestination(ABC):
    """All destination plugins implement this interface."""

    @abstractmethod
    def upload(self, local_path: str, remote_filename: str) -> str:
        """Upload file to destination. Returns path/URL where file was stored."""
        raise NotImplementedError

    @abstractmethod
    def delete(self, remote_path: str) -> None:
        """Delete a backup file at the given remote path."""
        raise NotImplementedError

    @abstractmethod
    def list_backups(self, prefix: str) -> List[str]:
        """List backup file paths for a given job prefix (for retention cleanup)."""
        raise NotImplementedError

    @abstractmethod
    def test_connection(self) -> bool:
        """Test that credentials/connection work. Raises on failure."""
        raise NotImplementedError


def get_destination(destination_type: str, config: dict) -> BaseDestination:
    """Factory: return the correct destination plugin for a given type."""
    if destination_type == "local":
        from app.services.destinations.local import LocalDestination
        return LocalDestination(config)
    elif destination_type == "sftp":
        from app.services.destinations.sftp import SftpDestination
        return SftpDestination(config)
    elif destination_type == "scp":
        from app.services.destinations.scp import ScpDestination
        return ScpDestination(config)
    elif destination_type == "s3":
        from app.services.destinations.s3 import S3Destination
        return S3Destination(config)
    elif destination_type == "google_drive":
        from app.services.destinations.google_drive import GoogleDriveDestination
        return GoogleDriveDestination(config)
    elif destination_type == "onedrive":
        from app.services.destinations.onedrive import OneDriveDestination
        return OneDriveDestination(config)
    else:
        raise ValueError(f"Unknown destination type: {destination_type}")
