---
title: Wide Events — the xlog Foundation
impact: CRITICAL
---

## Wide Events in xlog

One event per service hop. Build it during execution. Emit once in `finally`.

xlog provides three ways to do this — choose based on context.

---

### Pattern 1: Explicit Lifecycle (handlers, any async code)

```ts
import { xlog } from "@xlog/sdk";

app.post("/checkout", async ctx => {
  const event = xlog.start("checkout.completed", {
    kind: "request",
    service: "checkout-service",
  });

  try {
    const user = await getUser(ctx.userId);
    event.set("user.id", user.id);
    event.set("user.plan", user.plan);
    event.set("user.account_age_days", user.accountAgeDays);

    const cart = await getCart(user.id);
    event.set("cart.id", cart.id);
    event.set("cart.total_cents", cart.total);
    event.set("cart.item_count", cart.items.length);

    const payment = await charge(cart);
    event.set("payment.provider", payment.provider);
    event.set("payment.latency_ms", payment.latencyMs);
    event.set("payment.attempt", payment.attempt);

    event.success();
    return ctx.json({ ok: true });
  } catch (err) {
    event.error(err);    // sets error.type, error.message, error.code, error.stack
    throw err;
  } finally {
    event.emit();        // always runs — success or failure
  }
});
```

---

### Pattern 2: HTTP Middleware (auto-emits)

The middleware creates the event, captures timing and status, and emits in `finally`.
Handlers only add **business context**.

```ts
// Once at app setup
app.use(xlog.http({
  service: "checkout-service",
  eventName: "http.request",
}));

// Handler: just enrich
app.post("/checkout", async ctx => {
  xlog.set("user.id", ctx.user.id);
  xlog.set("user.plan", ctx.user.plan);
  xlog.set("cart.total_cents", ctx.cart.total);
  xlog.set("feature.new_checkout", ctx.flags.newCheckout);

  const payment = await charge(ctx.cart);
  xlog.set("payment.provider", payment.provider);
  xlog.set("payment.latency_ms", payment.latencyMs);

  return ctx.json({ ok: true });
  // Middleware emits at the end with http.method, http.status_code,
  // duration_ms, request.id, trace.id, service.* automatically filled
});
```

Emitted event includes all standard HTTP fields automatically:

```json
{
  "event.name": "http.request",
  "event.kind": "request",
  "event.outcome": "success",
  "http.method": "POST",
  "http.route": "/checkout",
  "http.status_code": 200,
  "duration_ms": 243,
  "request.id": "req_abc",
  "trace.id": "trace_xyz",
  "service.name": "checkout-service",
  "user.id": "user_7",
  "user.plan": "premium",
  "cart.total_cents": 15999,
  "feature.new_checkout": true,
  "payment.provider": "stripe",
  "payment.latency_ms": 189,
  "sample.kept": true,
  "sample.reason": "error"
}
```

---

### Pattern 3: Builder / `.run()` (jobs, workers, CLI tasks)

```ts
await xlog.event("email_digest.sent")
  .kind("job")
  .set("job.id", job.id)
  .set("job.queue", "default")
  .set("user.id", job.userId)
  .set("email.count", recipients.length)
  .run(async event => {
    const result = await sendDigest(recipients);
    event.set("email.sent", result.sent);
    event.set("email.failed", result.failed);
    event.set("email.provider", result.provider);
  });
// .run() calls event.success() or event.error() and event.emit() automatically
```

---

### Child Events

Use child events for external calls, DB queries above a threshold, retries, or tool calls.
**Do not use them to replace debug logs.** One or two per event is fine; ten is a smell.

```ts
await event.child("payment.provider.call", async child => {
  child.set("payment.provider", "stripe");
  child.set("payment.amount_cents", 15999);
  child.set("payment.currency", "usd");
  const result = await stripeCharge(amount);
  child.set("payment.charge_id", result.id);
});
// child auto-links via parent.event_id and trace.id
```

---

### Propagate request.id Across Services

Every event that calls a downstream service must forward `request.id` as a header.

```ts
// Outbound
await fetch("http://inventory-service/reserve", {
  headers: { "x-request-id": event.get("request.id") },
  body: JSON.stringify(payload),
});

// Inbound (inventory-service)
const event = xlog.start("inventory.reserve", { kind: "request" });
event.set("request.id", req.headers["x-request-id"]);
// Now both events share the same request.id — queryable together
```

---

### Error Fields (structured, not strings)

```ts
// xlog.error() auto-populates these from the thrown Error:
{
  "error.type": "PaymentError",
  "error.message": "Card declined by issuer",
  "error.code": "card_declined",
  "error.retriable": false,
  "error.stack": "...",
  "error.cause.type": "StripeError",
  "error.cause.code": "insufficient_funds"
}

// You can also pass extra fields:
event.error(err, {
  "payment.provider": "stripe",
  "payment.attempt": 3,
});
```

Never do: `event.set("error", err.message)` — that loses structure.
