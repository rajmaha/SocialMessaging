# ── Frontend Dockerfile (production, multi-stage) ──
# Compatible with Coolify, plain Docker, and docker-compose

# Stage 1: Install deps + build
FROM node:22-alpine AS builder

# Native build tools for npm packages that need compilation
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Build-time: NEXT_PUBLIC_API_URL is empty so browser calls same origin.
# Next.js rewrites proxy API calls to the backend container internally.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV BACKEND_INTERNAL_URL=http://backend:8000

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

# Internal URL for Next.js rewrites to reach the backend container
ENV BACKEND_INTERNAL_URL=http://backend:8000

RUN adduser --disabled-password --gecos "" appuser

# Copy built output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (r) => process.exit(r.statusCode < 400 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
