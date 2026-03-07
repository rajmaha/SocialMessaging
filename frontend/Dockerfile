# ── Frontend Dockerfile (production, multi-stage) ──
# Compatible with Coolify, plain Docker, and docker-compose

# Stage 1: Install deps + build
FROM node:22-alpine AS builder

# Native build tools for npm packages that need compilation
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Build-time env — declare ARG early so Coolify injection works
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Copy package files and install deps
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm install; else npm install; fi

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Minimal production image
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN adduser --disabled-password --gecos "" appuser

# Copy built output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://localhost:3000 || exit 1

CMD ["node", "server.js"]
