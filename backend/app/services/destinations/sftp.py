# backend/app/services/destinations/sftp.py
import os
from io import StringIO
from typing import List
import paramiko
from app.services.destinations.base import BaseDestination


class SftpDestination(BaseDestination):
    def __init__(self, config: dict):
        self.host = config["host"]
        self.port = int(config.get("port", 22))
        self.username = config["username"]
        self.password = config.get("password")
        self.ssh_key = config.get("ssh_key")
        self.remote_path = config.get("remote_path", "/backups")

    def _get_client(self):
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {"hostname": self.host, "port": self.port, "username": self.username}
        if self.ssh_key:
            pkey = paramiko.RSAKey.from_private_key(StringIO(self.ssh_key))
            kwargs["pkey"] = pkey
        else:
            kwargs["password"] = self.password
        client.connect(**kwargs)
        sftp = client.open_sftp()
        return sftp, client

    def upload(self, local_path: str, remote_filename: str) -> str:
        sftp, ssh = self._get_client()
        try:
            try:
                sftp.mkdir(self.remote_path)
            except OSError:
                pass
            remote_full = f"{self.remote_path}/{remote_filename}"
            sftp.put(local_path, remote_full)
            return remote_full
        finally:
            sftp.close()
            ssh.close()

    def delete(self, remote_path: str) -> None:
        sftp, ssh = self._get_client()
        try:
            sftp.remove(remote_path)
        finally:
            sftp.close()
            ssh.close()

    def list_backups(self, prefix: str) -> List[str]:
        sftp, ssh = self._get_client()
        try:
            files = sftp.listdir(self.remote_path)
            return sorted([
                f"{self.remote_path}/{f}" for f in files if f.startswith(prefix)
            ])
        finally:
            sftp.close()
            ssh.close()

    def test_connection(self) -> bool:
        sftp, ssh = self._get_client()
        sftp.close()
        ssh.close()
        return True
