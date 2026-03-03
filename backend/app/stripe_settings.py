# stripe_settings.py
# A simple configuration module for Stripe credentials and identifiers.
#
# Instead of relying on environment variables, you can edit the values
# below directly in the source. This is convenient for local development or
# projects where you prefer code‑based configuration.
#
# If you DO use environment variables, the billing router will fall back to
# them when the fields here are empty.

# secret key (starts with sk_test_ or sk_live_)
API_KEY: str = ""

# webhook signing secret (optional; used to verify inbound events)
WEBHOOK_SECRET: str = ""

# price identifiers created in your Stripe dashboard.  Add as many as you
# need; the frontend and backend reference them by key when creating
# checkout sessions.
PRICE_IDS: dict[str, str] = {
    # example:
    # "pro": "price_1Hxxxxxx789",
}

# helper for getting a price id by plan name

def get_price_id(name: str) -> str | None:
    return PRICE_IDS.get(name)
