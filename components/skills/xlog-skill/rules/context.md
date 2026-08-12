---
title: Context — Cardinality, Dimensionality, Business & Environment
impact: CRITICAL
---

## Context in xlog Events

A wide event is only useful if it contains enough context to answer questions you haven't thought of yet.
Two properties make that possible: **high cardinality** and **high dimensionality**.

---

### High Cardinality

Fields like `user.id`, `request.id`, `cart.id`, `tenant.id`, `order.id`, `trace.id` can have millions of
unique values. xlog is designed for this. Never aggregate away these IDs — they are the point.

```json
{
  "user.id": "user_7f3k2",
  "request.id": "req_abc123",
  "cart.id": "cart_9x7",
  "tenant.id": "tenant_acme",
  "trace.id": "trace_4b2f",
  "deployment.id": "deploy_2026-05-10-v3"
}
```

These fields let you answer: *"What happened to this specific user's request?"*

---

### High Dimensionality

xlog events should comfortably hold 30–100 fields. More fields = more questions answerable without
redeploying code. When in doubt, add the field.

A well-structured checkout event:

```ts
event.set("user.id", user.id);
event.set("user.plan", user.plan);                      // "free" | "premium" | "enterprise"
event.set("user.account_age_days", user.accountAgeDays);
event.set("user.lifetime_value_cents", user.ltv);

event.set("cart.id", cart.id);
event.set("cart.total_cents", cart.total);
event.set("cart.item_count", cart.items.length);
event.set("cart.coupon_applied", cart.coupon ?? null);

event.set("payment.provider", "stripe");
event.set("payment.method", "card");
event.set("payment.latency_ms", paymentLatency);
event.set("payment.attempt", attempt);

event.set("feature.new_checkout", flags.newCheckout);
event.set("experiment.checkout_redesign.variant", "B");
```

---

### Always Include Business Context

Technical context tells you *what broke*. Business context tells you *why it matters*.

```ts
// ❌ Technical only — incomplete picture
event.set("http.status_code", 500);
event.set("error.code", "card_declined");

// ✅ Business context included — actionable picture
event.set("http.status_code", 500);
event.set("error.code", "card_declined");
event.set("user.plan", "enterprise");
event.set("user.lifetime_value_cents", 4850000);  // $48,500 LTV
event.set("cart.total_cents", 249900);             // $2,499 order at stake
event.set("feature.new_payment_flow", true);       // Was new code involved?
```

Now you know: *Enterprise customer, $48k LTV, losing a $2.5k order, new code enabled.*

**Fields to always consider:**
- `user.plan`, `user.account_age_days`, `user.lifetime_value_cents`
- `cart.total_cents`, `cart.item_count`, `cart.coupon_applied`
- `order.id`, `order.type`, `order.contains_annual_plan`
- `feature.*` flags (crucial for rollout debugging)
- `experiment.*.variant` (A/B test assignments)

---

### Always Include Environment Context

Every event should carry the deployment and runtime context. Set this once at startup via the xlog config
or middleware — it attaches automatically.

```ts
// xlog config (loaded once)
xlog.configure({
  service: {
    name: process.env.SERVICE_NAME,
    version: process.env.SERVICE_VERSION,
    environment: process.env.NODE_ENV,
  },
  runtime: {
    commitHash: process.env.COMMIT_SHA,
    deploymentId: process.env.DEPLOYMENT_ID,
    region: process.env.AWS_REGION,
    instanceId: process.env.HOSTNAME,
    nodeVersion: process.version,
  },
});
```

These fields appear automatically on every event:

```json
{
  "service.name": "checkout-service",
  "service.version": "2.4.1",
  "environment": "production",
  "region": "ap-south-1",
  "host.name": "host-22",
  "runtime.name": "node",
  "runtime.version": "22.0.0",
  "deployment.id": "deploy_456"
}
```

**Why each matters:**
- `service.version` + `deployment.id` → correlate errors with deploys
- `region` → identify region-specific failures
- `host.name` → debug issues on specific instances
- `runtime.version` → catch runtime-version regressions

---

### AI Agent Context

For `agent` kind events, include model and tool fields:

```ts
event.set("agent.id", agent.id);
event.set("agent.run_id", run.id);
event.set("model.name", "claude-sonnet-4-20250514");
event.set("model.provider", "anthropic");
event.set("tokens.input", usage.inputTokens);
event.set("tokens.output", usage.outputTokens);
event.set("tool.name", tool.name);
event.set("tool.call_id", tool.callId);
event.set("tool.latency_ms", tool.latencyMs);
event.set("tool.outcome", "success");
event.set("safety.blocked", false);
```

These fields enable queries like:
```sql
-- Which tool causes the most agent failures?
SELECT tool_name, count(*) FROM xlog_events
WHERE event_kind = 'agent' AND event_outcome = 'error'
GROUP BY tool_name ORDER BY count(*) DESC;

-- Model cost by workflow
SELECT model_name, sum(tokens_input + tokens_output) FROM xlog_events
WHERE event_kind = 'agent' GROUP BY model_name;
```

---

### Privacy: Fields That Must Never Be Set

xlog will warn or block these at the SDK level. Do not attempt to work around it.

| Field pattern | Why |
|---------------|-----|
| `password`, `token`, `authorization` | Secrets |
| `cookie`, `card.number` | Sensitive auth / PCI |
| `user.email` | PII — use `user.email_hash` if needed |
| `http.client_ip` | PII — use `http.client_ip_hash` |
| Raw request/response bodies | Too large, likely contains secrets |

Use hashed or anonymized variants. The schema config controls this:

```yaml
redaction:
  hash:
    - user.email
    - http.client_ip
  deny:
    - password
    - token
    - authorization
    - cookie
    - card.number
```
