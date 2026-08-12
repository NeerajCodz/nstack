# Dockerfile Patterns — Annotated Examples

## Node.js (TypeScript / Next.js)

```dockerfile
# Stage 1: Install all deps (including dev)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable pnpm && pnpm build && pnpm prune --prod

# Stage 3: Production runtime
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 appuser

ENV NODE_ENV=production PORT=3000

COPY --from=builder --chown=appuser:nodejs /app/dist       ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/package.json ./

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1))"

CMD ["node", "dist/index.js"]
```

---

## Go

```dockerfile
# Stage 1: Build binary
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download                     # cached unless go.mod changes
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# Stage 2: Minimal runtime (distroless — no shell at all)
FROM gcr.io/distroless/static-debian12 AS runner
COPY --from=builder /app/server /server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s \
  CMD ["/server", "healthcheck"]
ENTRYPOINT ["/server"]
```

Result: binary ~5–15 MB, final image ~5–20 MB.

---

## Python (FastAPI / Flask)

```dockerfile
# Stage 1: Build wheels
FROM python:3.12-alpine AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime
FROM python:3.12-alpine AS runner
WORKDIR /app

RUN adduser --disabled-password --gecos "" appuser
COPY --from=builder /install /usr/local
COPY --chown=appuser:appuser . .

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## Using BuildKit Secrets (never bake secrets in ENV)

```dockerfile
# syntax=docker/dockerfile:1.6
FROM alpine AS fetcher
RUN --mount=type=secret,id=api_token \
    curl -H "Authorization: Bearer $(cat /run/secrets/api_token)" \
         https://private.registry.example.com/artifact -o /artifact

FROM alpine AS runner
COPY --from=fetcher /artifact /app/artifact
```

Build with:
```bash
docker buildx build --secret id=api_token,src=./token.txt .
```

Secret is **never written to any layer** — invisible in `docker history`.
