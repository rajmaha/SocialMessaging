# ── Frontend Dockerfile (production, multi-stage) ──

# Stage 1: Install deps + build
FROM node:18-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

# Build-time env — override at build via --build-arg
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY . .
RUN npm run build

# Stage 2: Production image (standalone output)
FROM node:18-alpine
WORKDIR /app

RUN adduser --disabled-password --gecos "" appuser

# Copy only what's needed to run
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://localhost:3000 || exit 1

CMD ["node", "server.js"]
