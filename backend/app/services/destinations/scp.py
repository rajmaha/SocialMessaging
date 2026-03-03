# backend/app/services/destinations/scp.py
import os
from io import StringIO
from typing import List
import paramiko
from app.services.destinations.base import BaseDestination


class ScpDestination(BaseDestination):
    def __init__(self, config: dict):
        self.host = config["host"]
        self.port = int(config.get("port", 22))
        self.username = config["username"]
        self.password = config.get("password")
        self.ssh_key = config.get("ssh_key")
        self.remote_path = config.get("remote_path", "/backups")

    def _get_ssh(self) -> paramiko.SSHClient:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {"hostname": self.host, "port": self.port, "username": self.username}
        if self.ssh_key:
            pkey = paramiko.RSAKey.from_private_key(StringIO(self.ssh_key))
            kwargs["pkey"] = pkey
        else:
            kwargs["password"] = self.password
        client.connect(**kwargs)
        return client

    def upload(self, local_path: str, remote_filename: str) -> str:
        ssh = self._get_ssh()
        try:
            sftp = ssh.open_sftp()
            ssh.exec_command(f"mkdir -p {self.remote_path}")
            remote_full = f"{self.remote_path}/{remote_filename}"
            sftp.put(local_path, remote_full)
            sftp.close()
            return remote_full
        finally:
            ssh.close()

    def delete(self, remote_path: str) -> None:
        ssh = self._get_ssh()
        try:
            ssh.exec_command(f"rm -f {remote_path}")
        finally:
            ssh.close()

    def list_backups(self, prefix: str) -> List[str]:
        ssh = self._get_ssh()
        try:
            stdin, stdout, stderr = ssh.exec_command(
                f"ls {self.remote_path}/{prefix}* 2>/dev/null || true"
            )
            output = stdout.read().decode().strip()
            return sorted(output.splitlines()) if output else []
        finally:
            ssh.close()

    def test_connection(self) -> bool:
        ssh = self._get_ssh()
        ssh.close()
        return True
