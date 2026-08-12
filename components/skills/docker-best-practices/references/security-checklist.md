# Docker Security Checklist (2026)

## Build-Time

- [ ] Use minimal base image (Alpine, distroless, Docker Hardened Image)
- [ ] Pin image by SHA256 digest, not just tag
- [ ] Multi-stage build — no build tools in final image
- [ ] Non-root USER declared in Dockerfile
- [ ] `.dockerignore` excludes `.git`, `*.env`, `*.pem`, `*.key`, `node_modules`, secrets
- [ ] No hardcoded secrets in `ENV`, `ARG`, or `RUN` steps
- [ ] Use `RUN --mount=type=secret` (BuildKit) for build-time secrets
- [ ] Pin all dependency versions (requirements.txt, package-lock.json, go.sum)
- [ ] `hadolint Dockerfile` passes in CI
- [ ] `trivy image --severity CRITICAL,HIGH` passes in CI

## Runtime

- [ ] `no-new-privileges:true` in security_opt
- [ ] `cap_drop: [ALL]` — add back only what's needed
- [ ] `read_only: true` filesystem
- [ ] Writable paths use `tmpfs`
- [ ] Memory limit set (`mem_limit` in Compose)
- [ ] CPU limit set (`cpus` in Compose)
- [ ] PID limit set (`pids_limit: 100`)
- [ ] Docker socket NOT mounted inside containers
- [ ] Custom Docker network (not default bridge)
- [ ] Network segmentation: services only on networks they need
- [ ] Secrets injected via Docker secrets or secret manager at runtime

## Registry / Supply Chain

- [ ] Push to private registry, not only Docker Hub
- [ ] Images tagged with git SHA (e.g., `myapp:abc1234`)
- [ ] SBOM generated: `docker buildx build --sbom=true --provenance=true`
- [ ] Images rebuilt regularly to pull base image security patches
- [ ] Vulnerability scan on schedule (weekly at minimum), not just on build

## Scanning Commands

```bash
# Trivy — most widely used open source scanner
trivy image myapp:v1.2.3
trivy image --severity CRITICAL,HIGH myapp:v1.2.3
trivy image --exit-code 1 --severity CRITICAL myapp:v1.2.3   # fail CI
trivy conf Dockerfile                                          # lint misconfigs

# Docker Scout (built into Docker CLI)
docker scout cves myapp:latest
docker scout recommendations myapp:latest

# Snyk
snyk container test myapp:latest

# Dockerfile linting
hadolint Dockerfile

# Secret scanning
trufflehog docker --image myapp:latest

# Layer inspection
dive myapp:latest   # interactive explorer
docker history myapp:latest
```

## Common CVEs / Incident Patterns (2025–2026)

| Incident | Root Cause | Prevention |
|---|---|---|
| XZ Utils backdoor in Debian images (Aug 2025) | Mutable `latest` tags | Digest pinning + weekly rebuilds |
| 10,000+ Hub images leaking credentials | Hardcoded secrets in ENV | BuildKit secrets, runtime injection |
| Containers escaping to host | Running as root + excessive caps | `USER` + `cap_drop` |
