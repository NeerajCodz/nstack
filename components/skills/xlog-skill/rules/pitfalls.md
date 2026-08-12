---
title: Common Pitfalls
impact: MEDIUM
---

## xlog Pitfalls

### Pitfall 1: Scattered `event.set` calls without a parent event

Setting fields without a live event context is a no-op or throws in strict mode.

```ts
// ❌ No event in context
xlog.set("user.id", user.id);  // Which event? Unknown.

// ✅ Always have an active event
const event = xlog.start("checkout.completed", { kind: "request" });
event.set("user.id", user.id);
// or inside xlog.http() middleware — xlog.set() works because middleware created the event
```

---

### Pitfall 2: Calling `event.emit()` outside `finally`

If emit is in `try` only, failures before it mean no event is recorded — the worst time to go dark.

```ts
// ❌ Emit only on success path
try {
  // ... logic ...
  event.success();
  event.emit();   // Not called if an exception is thrown above
} catch (err) {
  event.error(err);
  // emit never called on failure
}

// ✅ Emit in finally — always runs
try {
  // ...
  event.success();
} catch (err) {
  event.error(err);
  throw err;
} finally {
  event.emit();   // Guaranteed to run
}
```

---

### Pitfall 3: Setting error as a string instead of calling `event.error()`

```ts
// ❌ Loses structure
event.set("error", err.message);
event.set("error.details", JSON.stringify(err));

// ✅ Structured error
event.error(err);
// Produces: error.type, error.message, error.code, error.retriable, error.stack, error.cause.*
```

---

### Pitfall 4: Using child events as debug logs

```ts
// ❌ Child per debug statement — defeats the purpose
await event.child("loaded user", async c => { c.set("x", 1); });
await event.child("loaded cart", async c => { c.set("y", 2); });
await event.child("computed total", async c => { c.set("z", 3); });

// ✅ Just set fields on the parent event
event.set("user.id", user.id);
event.set("cart.id", cart.id);
event.set("cart.total_cents", cart.total);
```

Child events are for external service calls, DB calls, retries, and AI tool calls — not debug breadcrumbs.

---

### Pitfall 5: Camel-case or inconsistent field names

```ts
// ❌ Inconsistent names across services
event.set("userId", user.id);      // camelCase
event.set("user_id", user.id);     // snake_root
event.set("uid", user.id);         // alias
event.set("actor.id", user.id);    // different namespace

// ✅ Dot-separated lowercase everywhere
event.set("user.id", user.id);     // canonical
```

Define `xlog.schema.yaml` and run `xlog schema check` in CI to catch drift.

---

### Pitfall 6: Not propagating `request.id` across services

```ts
// ❌ Downstream call without request ID
await fetch("http://inventory-service/reserve", {
  body: JSON.stringify(payload),
});
// Inventory's events have no link to checkout's events

// ✅ Always forward request ID
await fetch("http://inventory-service/reserve", {
  headers: {
    "x-request-id": event.get("request.id"),
    "traceparent": event.get("trace.id"),  // OTel propagation
  },
  body: JSON.stringify(payload),
});
```

---

### Pitfall 7: Logging sensitive fields directly

```ts
// ❌ PII / secrets in the event
event.set("user.email", user.email);       // PII
event.set("payment.card_number", card.n);  // PCI
event.set("authorization", req.headers.authorization);  // Secret

// ✅ Use hashed variants or omit entirely
event.set("user.email_hash", hash(user.email));  // configured via redaction.hash
// card.number → blocked by redaction.deny at SDK level
```

---

### Pitfall 8: Forgetting outcome

An event without `event.outcome` is hard to query and triggers schema warnings.

```ts
// ❌ No outcome
const event = xlog.start("order.refunded", { kind: "workflow" });
event.set("order.id", order.id);
event.emit();

// ✅ Always set outcome
try {
  // ...
  event.success();   // sets event.outcome = "success"
} catch (err) {
  event.error(err);  // sets event.outcome = "error"
  throw err;
} finally {
  event.emit();
}
```

---

### Pitfall 9: Multiple xlog instances

```ts
// ❌ New instance per file
import { XLog } from "@xlog/sdk";
const xlog = new XLog({ service: "checkout" });  // misconfigured, different exporter

// ✅ Import the configured singleton
import { xlog } from "../lib/xlog";  // configured once at startup
```

---

### Pitfall 10: Setting fields after emit

```ts
// ❌ Set after emit — silently ignored or throws
event.emit();
event.set("payment.provider", "stripe");  // too late

// ✅ Set before emit — in try block, before finally
try {
  event.set("payment.provider", "stripe");
  event.success();
} catch (err) {
  event.error(err);
  throw err;
} finally {
  event.emit();
}
```
