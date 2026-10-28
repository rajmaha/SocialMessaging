# backend/app/services/destinations/local.py
import os
import shutil
from typing import List
from app.services.destinations.base import BaseDestination


class LocalDestination(BaseDestination):
    def __init__(self, config: dict):
        self.path = config.get("path", "/var/backups/socialmedia")

    def upload(self, local_path: str, remote_filename: str) -> str:
        os.makedirs(self.path, exist_ok=True)
        dest = os.path.join(self.path, remote_filename)
        shutil.copy2(local_path, dest)
        return dest

    def _inside(self, remote_path: str) -> str:
        """remote_path, refused unless it lies in this destination's folder."""
        root = os.path.realpath(self.path)
        real = os.path.realpath(remote_path)
        if os.path.commonpath([root, real]) != root:
            raise ValueError("That backup is not in this destination's folder.")
        return real

    def delete(self, remote_path: str) -> None:
        real = self._inside(remote_path)
        if os.path.exists(real):
            os.remove(real)

    def download(self, remote_path: str, local_path: str) -> None:
        shutil.copy2(self._inside(remote_path), local_path)

    def is_local_file(self, remote_path: str) -> bool:
        try:
            return os.path.isfile(self._inside(remote_path))
        except ValueError:
            return False

    def list_backups(self, prefix: str) -> List[str]:
        if not os.path.exists(self.path):
            return []
        return sorted([
            os.path.join(self.path, f)
            for f in os.listdir(self.path)
            if f.startswith(prefix)
        ])

    def test_connection(self) -> bool:
        os.makedirs(self.path, exist_ok=True)
        test_file = os.path.join(self.path, ".test_write")
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        return True
