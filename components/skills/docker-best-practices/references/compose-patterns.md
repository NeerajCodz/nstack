# Docker Compose Production Patterns

## Critical: deploy.resources vs mem_limit

`deploy.resources` is **Swarm-only** and silently ignored by `docker compose up`.
For standalone Compose, use top-level resource keys:

```yaml
services:
  api:
    mem_limit: 512m        # ✅ Works in standalone Compose
    cpus: 1.0              # ✅ Works in standalone Compose
    pids_limit: 100
    # deploy:              # ❌ Silently ignored unless using Swarm
    #   resources:
    #     limits:
    #       memory: 512m
```

---

## Full Production Template

```yaml
# docker-compose.yml
services:
  api:
    image: myapp:${IMAGE_TAG:-latest}
    restart: unless-stopped
    
    # Resource limits (standalone Compose)
    mem_limit: 512m
    cpus: 1.0
    pids_limit: 100

    # Security hardening
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    # cap_add:
    #   - NET_BIND_SERVICE   # only if port < 1024

    # Immutable filesystem
    read_only: true
    tmpfs:
      - /tmp
      - /var/run
      - /var/cache

    # Runtime config
    environment:
      NODE_ENV: production
    env_file:
      - .env.production    # never commit this file

    # Health check
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

    # Logging
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

    # Network isolation
    networks:
      - internal

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    mem_limit: 1g
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    networks:
      - internal
    # db NOT exposed to host — only api can reach it

secrets:
  db_password:
    file: ./secrets/db_password.txt

volumes:
  pgdata:

networks:
  internal:
    driver: bridge
  # public:   # add only if you need host-facing network separation
```

---

## Environment Variable Strategy

```bash
# .env (committed, non-secret defaults)
APP_PORT=3000
LOG_LEVEL=info

# .env.production (NOT committed — gitignore this)
DATABASE_URL=postgres://...
API_SECRET=...
```

```yaml
# docker-compose.yml
services:
  api:
    env_file:
      - .env            # base config
      - .env.production # secrets (injected at deploy time)
```

---

## Multi-Container Networking

```yaml
networks:
  frontend:   # nginx talks to api
    driver: bridge
  backend:    # api talks to db
    driver: bridge

services:
  nginx:
    networks: [frontend]
  api:
    networks: [frontend, backend]
  db:
    networks: [backend]     # db not reachable from nginx
  redis:
    networks: [backend]     # redis not reachable from nginx
```

---

## Health-Check Dependency Ordering

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy   # waits for db healthcheck to pass
  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
```

---

## Image Tagging Strategy

```bash
# In CI, tag with git SHA
IMAGE_TAG=$(git rev-parse --short HEAD)
docker build -t myapp:${IMAGE_TAG} -t myapp:latest .
docker push myapp:${IMAGE_TAG}
docker push myapp:latest

# Deploy with specific SHA, not latest
IMAGE_TAG=abc1234 docker compose up -d
```
