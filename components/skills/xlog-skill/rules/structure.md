---
title: Structure — SDK Setup, Middleware, Schema, Exporters
impact: HIGH
---

## xlog Structure

### Single xlog Instance

Configure xlog once at startup and import it everywhere. Never create multiple instances.

```ts
// lib/xlog.ts — configure once
import { xlog } from "@xlog/sdk";

xlog.configure({
  service: {
    name: process.env.SERVICE_NAME ?? "my-service",
    version: process.env.SERVICE_VERSION ?? "0.0.0",
    environment: process.env.NODE_ENV ?? "development",
    region: process.env.AWS_REGION,
  },
  schema: {
    mode: process.env.NODE_ENV === "production" ? "warn" : "strict",
    path: "./xlog.schema.yaml",
  },
  redaction: {
    mode: "strict",
    hash: ["user.email", "http.client_ip"],
    deny: ["password", "token", "authorization", "cookie"],
  },
  sampling: {
    errors: 1.0,
    slow_duration_ms: 2000,
    enterprise_users: 1.0,
    success: 0.05,
  },
  exporters: [
    { type: "stdout-json" },
    ...(process.env.OTEL_ENDPOINT
      ? [{ type: "otlp", endpoint: process.env.OTEL_ENDPOINT }]
      : []),
  ],
});

export { xlog };

// Usage elsewhere — just import
// services/checkout.ts
import { xlog } from "../lib/xlog";
```

---

### Middleware for HTTP Services

Middleware handles: event creation, timing, HTTP field population, tail sampling, and emission.
Handlers are responsible only for business context.

```ts
// middleware/xlog.ts
import { xlog } from "../lib/xlog";

export const xlogMiddleware = xlog.http({
  service: process.env.SERVICE_NAME!,
  eventName: "http.request",
  // Optionally override event name per route:
  eventNameFn: (req) => {
    if (req.path.startsWith("/checkout")) return "checkout.request";
    return "http.request";
  },
});

// app.ts — apply globally
app.use("*", xlogMiddleware);
```

Fields automatically populated by middleware:

```json
{
  "event.name": "http.request",
  "event.kind": "request",
  "event.outcome": "success | error",
  "http.method": "POST",
  "http.route": "/checkout",
  "http.path": "/checkout?coupon=SAVE20",
  "http.status_code": 200,
  "http.user_agent.family": "Chrome",
  "request.id": "req_abc",
  "trace.id": "trace_xyz",
  "span.id": "span_123",
  "duration_ms": 243,
  "timestamp": "2026-05-10T12:00:00.000Z",
  "service.name": "checkout-service",
  "service.version": "2.4.1",
  "environment": "production",
  "region": "ap-south-1"
}
```

---

### Schema File

Define a `xlog.schema.yaml` at the repo root. This enforces field types, catches typos, and prevents
naming drift across teams.

```yaml
# xlog.schema.yaml
fields:
  event.name:
    type: string
    required: true
  event.kind:
    type: enum
    values: [request, job, workflow, message, agent, system, security, audit]
    required: true
  event.outcome:
    type: enum
    values: [success, error, timeout, cancelled, rejected, unknown]
    required: true
  user.id:
    type: string
    cardinality: high
  user.plan:
    type: enum
    values: [free, starter, premium, enterprise]
  duration_ms:
    type: number
    unit: millisecond
  http.status_code:
    type: integer
  error.code:
    type: string
  cart.total_cents:
    type: integer
    unit: cents
  tokens.input:
    type: integer
  tokens.output:
    type: integer
```

Schema modes:

| Mode | Behavior |
|------|----------|
| `off` | No validation |
| `warn` | Logs unknown/invalid fields (good for production) |
| `strict` | Throws on invalid events (good for development/CI) |
| `shadow` | Validates silently — for gradual rollout |

---

### Exporters

Configure in `xlog.configure()`. Multiple exporters run in parallel.

```ts
exporters: [
  // Local / dev
  { type: "stdout-json" },          // Newline-delimited JSON to stdout

  // OpenTelemetry (works with any OTel collector)
  { type: "otlp", endpoint: "http://otel-collector:4318" },

  // ClickHouse (reference backend)
  { type: "clickhouse", dsn: process.env.CLICKHOUSE_DSN },

  // S3 Parquet (cost-efficient cold storage)
  { type: "s3-parquet", bucket: "my-xlog-events", region: "ap-south-1" },

  // Kafka (streaming pipelines)
  { type: "kafka", brokers: ["kafka:9092"], topic: "xlog.events" },
]
```

---

### Local Dev Output

In development, xlog prints human-readable events:

```
xlog checkout.completed error 1247ms
  request.id=req_1 trace.id=trace_abc
  user.id=user_7 user.plan=premium
  cart.total_cents=15999
  payment.provider=stripe payment.attempt=3
  error.code=card_declined
```

In production it emits structured JSON / OTLP. Same code, different exporter.

---

### Two Log Levels Only

xlog uses two levels internally:

- **`info`** — all events, including errors (`event.outcome=error`)
- **`error`** — SDK-level failures (export failed, schema panicked)

Do not expose `debug`, `warn`, `trace`, or `verbose` to application code.
If you want more detail, **add fields to the event** rather than adding log levels.

---

### Field Count and Safety Limits

The SDK enforces these by default:

| Limit | Default |
|-------|---------|
| Max fields per event | 200 |
| Max value size | 4 KB |
| Max object depth | 5 |
| Max array length | 50 |

Events exceeding limits are either truncated (warn mode) or rejected (strict mode) and never crash the
application.
