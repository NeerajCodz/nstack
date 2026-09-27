import { httpRouter } from "convex/server";
import { api, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { oauthCallback } from "./linear";
const http = httpRouter();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
async function clientHash(request: Request): Promise<string | undefined> {
  const address = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const keyMaterial = process.env.LINEAR_TOKEN_ENCRYPTION_KEY;
  if (!address || address.length > 128 || !keyMaterial) return undefined;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(keyMaterial), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`nstack-linear-auth-client:${address}`)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function errorResponse(error: unknown): Response {
  let data: { code?: unknown; message?: unknown; writeId?: unknown; nextSteps?: unknown } | undefined;
  if (error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object") {
    data = error.data as typeof data;
  } else if (error instanceof Error) {
    try {
      const parsed: unknown = JSON.parse(error.message);
      if (parsed && typeof parsed === "object") data = parsed as typeof data;
    } catch { /* Unknown errors use the generic response. */ }
  }
  if (data) {
    const code = typeof data.code === "string" ? data.code : "linear_request_failed";
    const message = typeof data.message === "string" ? data.message : "The Linear request could not be completed.";
    const details = {
      code,
      message,
      ...(typeof data.writeId === "string" ? { writeId: data.writeId } : {}),
      ...(typeof data.nextSteps === "string" ? { nextSteps: data.nextSteps } : {})
    };
    const status = code === "linear_not_connected" || code.includes("expired") ? 401
      : code.includes("rate_limited") ? 429
        : code.includes("permission_denied") ? 403
          : code.includes("timeout") ? 504
            : code.includes("invalid") ? 400 : 502;
    return json({ error: details }, status);
  }
  return json({ error: { code: "linear_request_failed", message: "The Linear request could not be completed." } }, 500);
}

const beginCliAuth = httpAction(async (ctx, request) => {
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);
  const body = await readBody(request);
  if (!body || typeof body.pollSecretHash !== "string") return json({ error: { code: "linear_auth_invalid", message: "pollSecretHash is required." } }, 400);
  const addressHash = await clientHash(request);
  if (!addressHash) return json({ error: { code: "linear_auth_unavailable", message: "A client address could not be determined." } }, 503);
  try {
    const result = await ctx.runMutation(internal.linear.beginCliAuth, { pollSecretHash: body.pollSecretHash, clientHash: addressHash });
    return json(result, 201);
  } catch (error) { return errorResponse(error); }
});

const pollCliAuth = httpAction(async (ctx, request) => {
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);
  const body = await readBody(request);
  if (!body || typeof body.requestId !== "string" || typeof body.pollSecret !== "string") return json({ error: { code: "linear_auth_invalid", message: "requestId and pollSecret are required." } }, 400);
  try {
    return json(await ctx.runAction(api.linear.pollCliAuth, { requestId: body.requestId, pollSecret: body.pollSecret }));
  } catch (error) { return errorResponse(error); }
});

const revokeCliSession = httpAction(async (ctx, request) => {
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);
  const body = await readBody(request);
  if (!body || typeof body.sessionToken !== "string") return json({ error: { code: "linear_auth_invalid", message: "sessionToken is required." } }, 400);
  try {
    return json(await ctx.runAction(api.linear.revokeCliSession, { sessionToken: body.sessionToken }));
  } catch (error) { return errorResponse(error); }
});

const linearRequest = httpAction(async (ctx, request) => {
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);
  const body = await readBody(request);
  if (!body || typeof body.operation !== "string" || body.args === null || typeof body.args !== "object" || Array.isArray(body.args)) {
    return json({ error: { code: "linear_invalid_arguments", message: "operation and an arguments object are required." } }, 400);
  }
  if ((body.apiKey !== undefined && typeof body.apiKey !== "string") || (body.sessionToken !== undefined && typeof body.sessionToken !== "string")) {
    return json({ error: { code: "linear_auth_invalid", message: "apiKey and sessionToken must be strings when supplied." } }, 400);
  }
  try {
    return json(await ctx.runAction(api.linear.linearRequest, {
      operation: body.operation,
      args: body.args,
      ...(typeof body.sessionToken === "string" ? { sessionToken: body.sessionToken } : {}),
      ...(typeof body.apiKey === "string" ? { apiKey: body.apiKey } : {})
    }));
  } catch (error) { return errorResponse(error); }
});

http.route({ path: "/linear/cli/auth/begin", method: "POST", handler: beginCliAuth });
http.route({ path: "/linear/cli/auth/poll", method: "POST", handler: pollCliAuth });
http.route({ path: "/linear/cli/auth/revoke", method: "POST", handler: revokeCliSession });
http.route({ path: "/linear/cli/request", method: "POST", handler: linearRequest });
http.route({ path: "/linear/oauth/callback", method: "GET", handler: oauthCallback });

export default http;
