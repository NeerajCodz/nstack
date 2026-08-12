---
name: xlog
description: >
  Apply xlog wide-event logging when writing or reviewing any observability, logging, or instrumentation code.
  xlog replaces scattered log statements with a single context-rich canonical event per operation, emitted
  once when the outcome is known. Use this skill whenever the user is: adding logging to a service, handler,
  worker, job, or AI agent; reviewing existing log/console/logger calls; designing observability strategy;
  asking about structured logging, canonical log lines, wide events, or OpenTelemetry; importing any logger
  (pino, winston, zap, slog, structlog, log/slog); or asking how to debug production issues with logs.
  Even if the user only says "add some logging here" — apply xlog.
---

# xlog Skill

xlog is a wide-event logging framework. Instead of scattering log lines across a codebase, you build
**one rich event per operation** (request, job, workflow, agent run), enrich it with technical and business
context as execution progresses, then emit it once when the outcome is known.

> One event. The whole story.

## Core Rule

**Never write scattered log lines.** Write one xlog event per service hop.

```ts
// ❌ Old model — scattered diary
console.log("payment started");
console.log("retry attempt 2");
logger.error("payment failed", { code: "card_declined" });

// ✅ xlog model — one canonical event
const event = xlog.start("checkout.completed", { kind: "request" });
try {
  event.set("payment.provider", "stripe");
  event.set("payment.attempt", 2);
  event.success();
} catch (err) {
  event.error(err);
  throw err;
} finally {
  event.emit();
}
```

## When to Read Rule Files

| Task | Read |
|------|------|
| Writing any event / handler / middleware | `rules/wide-events.md` (CRITICAL) |
| Deciding which fields to add | `rules/context.md` (CRITICAL) |
| Setting up logger, middleware, JSON format | `rules/structure.md` (HIGH) |
| Reviewing existing logging code for issues | `rules/pitfalls.md` (MEDIUM) |

Always read at least `wide-events.md` and `context.md` before writing any xlog code.

## Field Naming Convention

xlog uses dot-separated lowercase namespaces. This is non-negotiable.

```
service.name      user.id          cart.total_cents
request.id        trace.id         payment.provider
http.status_code  error.code       feature.new_checkout
agent.run_id      model.name       tokens.input
```

**Never** use camelCase (`userId`), snake_root (`user_id` at top level), or inconsistent aliases.

## Required Fields on Every Event

```json
{
  "event.name": "checkout.completed",
  "event.kind": "request",
  "event.outcome": "success | error | timeout | cancelled | rejected | unknown",
  "timestamp": "2026-05-10T12:00:00.000Z",
  "duration_ms": 123,
  "service.name": "checkout-service",
  "service.version": "1.2.3",
  "environment": "production"
}
```

## SDK Quick Reference

```ts
// Explicit lifecycle
const event = xlog.start("op.name", { kind: "request", service: "my-svc" });
event.set("user.id", user.id);
event.set("cart.total_cents", cart.total);
event.error(err);   // or event.success()
event.emit();       // always in finally

// Builder / run pattern (jobs, workers)
await xlog.event("email_digest.sent")
  .kind("job")
  .set("job.id", job.id)
  .set("email.count", count)
  .run(async event => {
    const r = await sendDigest();
    event.set("email.sent", r.sent);
    event.set("email.failed", r.failed);
  });

// HTTP middleware (auto-emits)
app.use(xlog.http({ service: "checkout-service", eventName: "http.request" }));

// Inside handler — just enrich
xlog.set("user.id", ctx.user.id);
xlog.set("feature.new_checkout", ctx.flags.newCheckout);

// Child event for external calls
await event.child("payment.provider.call", async child => {
  child.set("payment.provider", "stripe");
  child.set("payment.amount_cents", 15999);
  await chargeCard();
});
```

## Sampling (built-in, tail-based)

Sampling decisions happen **after** outcome is known — never before.

```yaml
sampling:
  keep:
    errors: true
    status_code_gte: 500
    duration_ms_gte: 2000
    users:
      plans: [enterprise]
  sample:
    success_rate: 0.05
```

Every emitted event includes sampling metadata:

```json
{ "sample.kept": true, "sample.rate": 0.05, "sample.reason": "error" }
```

## Event Kinds

| Kind | Use for |
|------|---------|
| `request` | HTTP / RPC / API call |
| `job` | Background job |
| `workflow` | Multi-step business flow |
| `message` | Queue / message processing |
| `agent` | AI agent / tool execution |
| `system` | Runtime / infra events |
| `security` | Auth, access, policy |
| `audit` | Compliance events |
