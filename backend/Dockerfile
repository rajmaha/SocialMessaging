# ── Backend Dockerfile (production) ──
FROM python:3.11-slim

WORKDIR /app

# System deps for psycopg2-binary and healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    ffmpeg \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps (prod file excludes macOS-only pyobjc packages)
COPY requirements.prod.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create dirs for file uploads (persisted via volumes)
RUN mkdir -p /app/app/avatar_storage \
             /app/app/attachment_storage/messages \
             /app/app/attachment_storage/campaigns \
             /app/templates/default_site

# Non-root user
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8000/docs || exit 1

# Single uvicorn worker — required for in-memory shared state:
#   • webchat_service.connections  (visitor WebSocket registry)
#   • events_service.active_connections  (agent SSE registry)
#   • bot_service._unmatched  (per-conversation unmatched counter)
# Multiple workers each have a separate copy of these dicts, so a
# WebSocket on worker A is invisible to an HTTP handler on worker B.
# FastAPI + asyncio handles thousands of concurrent connections with 1 worker.
CMD ["gunicorn", "main:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "1", \
     "--timeout", "120", \
     "--access-logfile", "-"]
