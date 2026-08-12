---
name: docker-best-practices
description: >
  Apply Docker best practices for writing Dockerfiles, optimizing image size, hardening security,
  managing multi-stage builds, configuring Docker Compose, and making containers production-ready.
  Use this skill whenever the user mentions Docker, Dockerfiles, containers, Docker Compose,
  image optimization, container security, .dockerignore, non-root users, multi-stage builds,
  health checks, distroless images, image scanning, or anything related to containerization.
  Trigger even for casual questions like "how do I make my Docker image smaller?",
  "is my Dockerfile secure?", "should I use Alpine or distroless?", or "what's wrong with my
  docker-compose.yml?". If Docker is involved in any way, use this skill.
---

# Docker Best Practices

Reference material synthesized from:
- *Docker Explained Step by Step | System Design* (ByteMonk, 2024)
- *Docker Image Optimisation – Production-Ready Docker Guide* (2024)
- *Docker in 2026: What Changed (And What You're Still Doing Wrong)* (2026)
- Official Docker documentation and 2026 security reports

For deep dives, read the reference files:
- `references/dockerfile-patterns.md` — annotated Dockerfile examples (Node, Go, Python)
- `references/security-checklist.md` — runtime + build-time security checklist
- `references/compose-patterns.md` — production docker-compose patterns

---

## Core Philosophy

Containers should be **lightweight, immutable, and disposable** — not mini virtual machines.
Never modify a running container; rebuild and redeploy instead.
Every decision flows from three axes: **size**, **security**, **reproducibility**.

---

## 0. The Architectural Foundation — Why Containers?

Understanding *why* Docker exists shapes every decision below.

### Containers vs. Virtual Machines

| | Virtual Machine | Container |
|---|---|---|
| **Includes** | Full Guest OS + virtual hardware + app | App + its dependencies only |
| **Size** | Gigabytes | Megabytes |
| **Boot time** | Minutes | Seconds (sub-second with distroless) |
| **Isolation** | Hypervisor-level (separate kernel) | OS-level (shared host kernel) |
| **Use case** | Full OS isolation, legacy apps | Microservices, CI/CD, cloud-native |

VMs virtualize hardware. Containers virtualize the OS userspace. Containers share the host kernel — which is why they're fast and small, but also why kernel-level exploits are a bigger risk if not hardened.

### The Core Object Model

```
Dockerfile  ──build──▶  Image  ──run──▶  Container
                 ↓                            ↓
            (read-only                (adds a writable
             snapshot)                 layer on top;
                 ↓                     ephemeral — lost
            pushed to                  on container stop)
            Registry
```

- **Dockerfile** — the recipe; text instructions that define the image
- **Image** — the read-only, immutable snapshot produced by `docker build`
- **Container** — a live running instance of an image; the writable layer is temporary
- **Registry** (Docker Hub, ECR, GHCR) — centralized store to push/pull images

**The key implication:** Any data written inside a container at runtime is lost when the container stops. Use **volumes** for persistence.

---

## 1. Base Image Selection

**Rule:** Use the smallest image that satisfies your runtime needs.

| Option | When to use |
|---|---|
| `node:22-alpine` | Most apps — small, musl libc, works 99% of time |
| `gcr.io/distroless/nodejs22-debian12` | High-security prod — no shell, no package manager |
| Docker Hardened Images (DHI) | Enterprise; Docker's Apache-2.0 hardened set (released late 2025) |
| `ubuntu` / `debian` | Only if you genuinely need glibc or system packages |

**Never use `latest` tags in production.** Pin by digest for true immutability:

```dockerfile
# Bad — mutable, unpredictable
FROM node:22-alpine

# Good — pinned tag
FROM node:22-alpine3.20

# Best — pinned by digest (immutable)
FROM node:22-alpine@sha256:a1b2c3d4...
```

**Why it matters:** In August 2025, dozens of official Debian-based Hub images were found shipping the XZ Utils backdoor (CVE-2024-3094, CVSS 10.0) months after disclosure. Teams using digest pinning were unaffected.

---

## 2. Multi-Stage Builds

Split build-time tools from the final runtime image. This is the single highest-impact optimization.

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production (only artifacts, no dev deps)
FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 appuser
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1))"
CMD ["node", "dist/index.js"]
```

Real-world result: Go apps go from ~1 GB → ~4 MB. Node apps from ~1.2 GB → ~10–50 MB.

For language-specific annotated examples, see `references/dockerfile-patterns.md`.

---

## 3. Layer Caching — Order Your Instructions Correctly

Docker invalidates cache at the first changed layer, cascading downward. Put **frequently changing things last**.

```dockerfile
# Bad — copying everything early busts cache on every code change
COPY . .
RUN npm install

# Good — copy dependency manifests first; npm install is cached until deps change
COPY package.json package-lock.json ./
RUN npm install
COPY . .          # code changes here only invalidate this layer and below
```

General ordering:
1. `FROM` base image
2. System-level `RUN` installs (rare changes)
3. Dependency manifests (`package.json`, `requirements.txt`, `go.mod`)
4. `RUN` install deps
5. Application `COPY`
6. `CMD` / `ENTRYPOINT`

---

## 4. Security Hardening

### Never run as root
```dockerfile
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser
```

### Drop all Linux capabilities, add back only what's needed
```yaml
# docker-compose.yml (standalone compose, NOT Swarm)
services:
  api:
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE   # only if binding port < 1024
    read_only: true
    tmpfs:
      - /tmp
      - /var/run
```

**Critical:** `deploy.resources` is silently ignored by `docker compose up` (it's Swarm-only).
Use `mem_limit` / `cpus` at the service level for standalone Compose.

### Never bake secrets into images
```dockerfile
# NEVER do this
ENV DB_PASSWORD=supersecret
RUN curl -H "Authorization: Bearer $API_KEY" https://api.example.com
```
Use Docker secrets, environment variables injected at runtime, or a secrets manager (Vault, AWS Secrets Manager). In 2025, researchers found 10,000+ Hub images leaking production credentials.

### Use `.dockerignore`
```
.git
node_modules
*.env
*.pem
*.key
__pycache__
.DS_Store
tests/
README.md
```

---

## 5. Image Scanning

Scan in CI before every push to a registry.

```bash
# Trivy (recommended, open source)
trivy image --severity CRITICAL,HIGH myapp:v1.2.3

# Fail CI on critical vulnerabilities
trivy image --exit-code 1 --severity CRITICAL myapp:v1.2.3

# Docker Scout (built into Docker CLI)
docker scout cves myapp:latest

# Lint your Dockerfile
hadolint Dockerfile
```

---

## 6. Health Checks

Always define a `HEALTHCHECK` so orchestrators (Docker Swarm, ECS, Compose) know when a container is actually ready.

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1
```

---

## 7. Minimize Layers — Combine Related RUN Commands

```dockerfile
# Bad — 3 separate layers
RUN apt-get update
RUN apt-get install -y curl git
RUN apt-get clean

# Good — 1 layer, and clean up in the same step
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
```

---

## 8. Pin Dependency Versions

```dockerfile
# Bad
FROM python:3
RUN pip install flask

# Good
FROM python:3.12.4-alpine3.20
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt   # requirements.txt has pinned versions
```

Use `pip-compile`, `npm ci` (not `npm install`), `go mod tidy`, etc. to generate locked manifests.

---

## 9. ENTRYPOINT vs CMD

- `ENTRYPOINT` — the executable (hard to override)
- `CMD` — default arguments (easily overridden at `docker run`)
- Always use **exec form** (JSON array), not shell form, for proper signal handling:

```dockerfile
# Shell form — PID 1 is /bin/sh, signals don't reach your app
CMD node server.js

# Exec form — PID 1 is your app, SIGTERM works correctly
CMD ["node", "server.js"]
```

---

## 10. Docker Compose Production Patterns

```yaml
services:
  api:
    image: myapp:${IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      NODE_ENV: production
    env_file:
      - .env.production
    mem_limit: 512m
    cpus: 1.0
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    read_only: true
    tmpfs:
      - /tmp
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - internal

networks:
  internal:
    driver: bridge
```

For full compose patterns with volumes, secrets, and networking, see `references/compose-patterns.md`.

---

## 11. What to Avoid — The Wall of Shame

A quick summary table for code review and teaching:

| ❌ Avoid This | ✅ Do This Instead |
|---|---|
| Running containers as root | Create a `USER appuser` in Dockerfile |
| `FROM ubuntu` / `FROM node:latest` for microservices | Use `alpine` or `slim` variants; pin by digest |
| Copying all source code before installing deps | Copy `package.json` first, then `COPY . .` |
| Hardcoding secrets in `ENV` or `ARG` | Use runtime env vars, Docker secrets, or a Secret Manager |
| Shipping build tools / source to production | Use multi-stage builds; ship only compiled artifacts |
| Relying on mutable tags (`:latest`) | Pin by SHA digest (`FROM node@sha256:abcd...`) |
| Separate `RUN apt-get update` + `apt-get install` | Combine and clean up in one `RUN` |
| No `HEALTHCHECK` | Always define one; orchestrators depend on it |
| `deploy.resources` in standalone Compose | Use `mem_limit` / `cpus` at service level |
| No vulnerability scanning | Run `trivy` or `docker scout` in CI on every build |

### Extended 2026 Gotchas

From *Docker in 2026: What Changed (And What You're Still Doing Wrong)*:

1. **Using `latest` tags** — stops being a best practice, starts being an incident.
2. **Running as root** — default Docker behavior; explicitly opt out with `USER`.
3. **Ignoring `cap_drop`** — containers get a generous default capability set; drop it.
4. **`deploy.resources` in standalone Compose** — silently ignored; use `mem_limit`/`cpus`.
5. **No SBOM** — the EU Cyber Resilience Act (September 2026) mandates SBOMs for software sold in the EU. Generate with: `docker buildx build --sbom=true --provenance=true .`
6. **No image scanning in CI** — vulnerabilities caught in prod cost 10× more to fix.
7. **Secrets in ENV at build time** — use `--secret` mount in BuildKit instead:
   ```dockerfile
   RUN --mount=type=secret,id=api_key \
       curl -H "Authorization: Bearer $(cat /run/secrets/api_key)" ...
   ```

---

## Quick-Reference Checklist

**Dockerfile**
- [ ] Minimal base image (Alpine, distroless, or DHI)
- [ ] Pin image by digest in production
- [ ] Multi-stage build
- [ ] Dependency manifests copied before source code (cache ordering)
- [ ] Combined `RUN` commands, clean up in same layer
- [ ] Non-root `USER`
- [ ] `HEALTHCHECK` defined
- [ ] Exec form `CMD ["executable"]`
- [ ] `.dockerignore` present
- [ ] No secrets at build time

**CI/CD**
- [ ] `hadolint` lints Dockerfile
- [ ] `trivy` scans image, fails on CRITICAL
- [ ] SBOM generated (`--sbom=true`)
- [ ] Image tagged with git SHA, not just `latest`

**Runtime / Compose**
- [ ] `no-new-privileges:true`
- [ ] `cap_drop: [ALL]`
- [ ] `read_only: true` with `tmpfs` for writable paths
- [ ] `mem_limit` + `cpus` set
- [ ] Secrets injected at runtime, not baked in
- [ ] Custom network (not default bridge)
