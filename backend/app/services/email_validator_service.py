"""
Email Validator Service — backend proxy for external email validation API.
All calls fail open: errors/timeouts never block the caller.
"""
import httpx
import logging
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class EmailValidatorService:

    @staticmethod
    def get_validator_config(db: Session) -> tuple[str, str, int] | None:
        """
        Returns (url, secret, threshold) tuple if configured, else None.
        """
        from app.models.branding import BrandingSettings
        branding = db.query(BrandingSettings).first()
        if not branding or not branding.email_validator_url or not branding.email_validator_secret:
            return None
        return (
            branding.email_validator_url.rstrip("/"),
            branding.email_validator_secret,
            branding.email_validator_risk_threshold or 60,
        )

    @staticmethod
    def validate_single(email: str, db: Session) -> dict | None:
        """
        Validate a single email address.
        Returns dict with at least {is_valid, risk_score} or None on error/not-configured.
        Always fails open.
        """
        config = EmailValidatorService.get_validator_config(db)
        if not config:
            return None
        url, secret, threshold = config
        try:
            resp = httpx.post(
                f"{url}/api/validate",
                json={"email": email},
                headers={"Authorization": f"Bearer {secret}"},
                timeout=5.0,
            )
            resp.raise_for_status()
            data = resp.json()
            # Normalise: add computed is_valid based on threshold
            risk_score = data.get("risk_score", 0)
            if "is_valid" not in data:
                data["is_valid"] = risk_score < threshold
            return data
        except Exception as exc:
            logger.warning("email_validator single failed for %s: %s", email[:3] + "***", exc)
            return None

    @staticmethod
    def validate_bulk(emails: list[str], db: Session) -> list[dict]:
        """
        Validate up to 500 emails per request.
        Returns list of result dicts or [] on error/not-configured.
        Always fails open.
        """
        if not emails:
            return []
        config = EmailValidatorService.get_validator_config(db)
        if not config:
            return []
        url, secret, threshold = config
        # Send in batches of 500
        all_results = []
        for i in range(0, len(emails), 500):
            batch = emails[i:i + 500]
            try:
                resp = httpx.post(
                    f"{url}/api/validate/bulk",
                    json={"emails": batch},
                    headers={"Authorization": f"Bearer {secret}"},
                    timeout=30.0,
                )
                resp.raise_for_status()
                results = resp.json()
                if isinstance(results, list):
                    # Normalise each result
                    for item in results:
                        risk_score = item.get("risk_score", 0)
                        if "is_valid" not in item:
                            item["is_valid"] = risk_score < threshold
                    all_results.extend(results)
                else:
                    logger.warning(
                        "email_validator bulk unexpected response type for batch starting %s: %s",
                        batch[0][:3] + "***", type(results)
                    )
            except Exception as exc:
                logger.warning("email_validator bulk failed for batch starting %s: %s", batch[0][:3] + "***", exc)
                # Fail open — return empty for this batch
        return all_results


email_validator_service = EmailValidatorService()
