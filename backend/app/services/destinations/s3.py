# backend/app/services/destinations/s3.py
from typing import List
from app.services.destinations.base import BaseDestination


class S3Destination(BaseDestination):
    def __init__(self, config: dict):
        self.bucket = config["bucket"]
        self.prefix = config.get("prefix", "backups")
        self.region = config.get("region", "us-east-1")
        self.access_key = config["access_key"]
        self.secret_key = config["secret_key"]
        self.endpoint_url = config.get("endpoint_url")  # for R2/MinIO

    def _get_client(self):
        import boto3
        kwargs = {
            "aws_access_key_id": self.access_key,
            "aws_secret_access_key": self.secret_key,
            "region_name": self.region,
        }
        if self.endpoint_url:
            kwargs["endpoint_url"] = self.endpoint_url
        return boto3.client("s3", **kwargs)

    def upload(self, local_path: str, remote_filename: str) -> str:
        s3 = self._get_client()
        key = f"{self.prefix}/{remote_filename}"
        s3.upload_file(local_path, self.bucket, key)
        return f"s3://{self.bucket}/{key}"

    def delete(self, remote_path: str) -> None:
        key = remote_path.replace(f"s3://{self.bucket}/", "")
        s3 = self._get_client()
        s3.delete_object(Bucket=self.bucket, Key=key)

    def list_backups(self, prefix: str) -> List[str]:
        s3 = self._get_client()
        resp = s3.list_objects_v2(Bucket=self.bucket, Prefix=f"{self.prefix}/{prefix}")
        contents = resp.get("Contents", [])
        return sorted([f"s3://{self.bucket}/{obj['Key']}" for obj in contents])

    def test_connection(self) -> bool:
        s3 = self._get_client()
        s3.head_bucket(Bucket=self.bucket)
        return True
