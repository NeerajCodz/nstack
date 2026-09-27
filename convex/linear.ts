import { ConvexError, v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";


const LINEAR_API = "https://api.linear.app/graphql";
const LINEAR_AUTH = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN = "https://api.linear.app/oauth/token";
const REQUEST_TTL = 10 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 65_000;
const MAX_COMMENT = 20_000;
const KNOWN_OPERATIONS: Record<string, true> = {
  "issue.get": true, "issue.search": true, "issue.list": true, "issue.listIssues": true, "team.list": true,
  "team.members": true, "team.states": true, "team.labels": true, "project.list": true, "issue.save": true,
  "issue.create": true, "relation.add": true, "relation.remove": true, "status.set": true,
  "assignee.set": true, "assignee.clear": true, "priority.set": true, "priority.clear": true,
  "estimate.set": true, "estimate.clear": true, "dueDate.set": true, "dueDate.clear": true,
  "label.add": true, "label.remove": true, "label.set": true, "comment.add": true, "attachment.add": true
};

const WRITE_OPERATIONS = new Set([
  "issue.save", "issue.create", "relation.add", "relation.remove", "status.set",
  "assignee.set", "assignee.clear", "priority.set", "priority.clear", "estimate.set",
  "estimate.clear", "dueDate.set", "dueDate.clear", "label.add", "label.remove",
  "label.set", "comment.add", "attachment.add"
]);

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail("linear_configuration_missing", `The service is missing ${name}.`);
  return value;
}
function randomBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  let raw: string;
  try { raw = atob(value); } catch { return new Uint8Array(0); }
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sessionTokenForRequest(requestId: string): Promise<string> {
  const raw = fromBase64(requiredEnv("LINEAR_TOKEN_ENCRYPTION_KEY"));
  if (raw.length !== 32) fail("linear_configuration_missing", "LINEAR_TOKEN_ENCRYPTION_KEY must be base64 for exactly 32 bytes.");
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`nstack-cli-session:${requestId}`));
  return base64url(new Uint8Array(bytes));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function encryptionKey(): Promise<CryptoKey> {
  const raw = fromBase64(requiredEnv("LINEAR_TOKEN_ENCRYPTION_KEY"));
  if (raw.length !== 32) fail("linear_configuration_missing", "LINEAR_TOKEN_ENCRYPTION_KEY must be base64 for exactly 32 bytes.");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptToken(token: string): Promise<string> {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(token));
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);
  return toBase64(result);
}
async function decryptToken(value: string): Promise<string> {
  const payload = fromBase64(value);
  if (payload.length < 29) fail("linear_auth_expired", "The stored Linear connection is invalid; sign in again.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: payload.slice(0, 12) }, await encryptionKey(), payload.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    fail("linear_auth_expired", "The stored Linear connection could not be decrypted; sign in again.");
  }
}
function safeRequestId(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 100) fail("linear_auth_invalid", "Invalid connection request.");
  return value;
}

export const beginCliAuth = internalMutation({
  args: { pollSecretHash: v.string(), clientHash: v.string() },
  handler: async (ctx, { pollSecretHash, clientHash }) => {
    if (!/^[0-9a-f]{64}$/.test(pollSecretHash) || !/^[0-9a-f]{64}$/.test(clientHash)) fail("linear_auth_invalid", "Invalid connection request.");
    const now = Date.now();
    const oldLimits = await ctx.db.query("oauthStartLimits").withIndex("by_window_end", (q) => q.lt("windowEndsAt", now)).take(25);
    for (const row of oldLimits) await ctx.db.delete(row._id);
    const prior = await ctx.db.query("oauthStartLimits").withIndex("by_client_hash", (q) => q.eq("clientHash", clientHash)).unique();
    if (prior && prior.windowEndsAt > now && prior.count >= 5) fail("linear_rate_limited", "Too many connection attempts. Wait before starting another.");
    const expiredRequests = await ctx.db.query("oauthRequests").withIndex("by_expires_at", (q) => q.lt("expiresAt", now)).take(25);
    for (const row of expiredRequests) await ctx.db.delete(row._id);
    const windowEndsAt = prior && prior.windowEndsAt > now ? prior.windowEndsAt : now + 10 * 60 * 1000;
    if (prior) await ctx.db.patch(prior._id, { windowEndsAt, count: prior.windowEndsAt > now ? prior.count + 1 : 1 });
    else await ctx.db.insert("oauthStartLimits", { clientHash, windowEndsAt, count: 1 });
    const expiresAt = now + REQUEST_TTL;
    const documentId = await ctx.db.insert("oauthRequests", { requestId: "", pollSecretHash, expiresAt, status: "pending" });
    const requestId = String(documentId);
    await ctx.db.patch(documentId, { requestId });
    return { requestId, expiresAt };
  }
});

export const startLinearOAuth = action({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    safeRequestId(requestId);
    const clientId = requiredEnv("LINEAR_OAUTH_CLIENT_ID");
    requiredEnv("LINEAR_OAUTH_CLIENT_SECRET");
    const redirectUri = requiredEnv("LINEAR_OAUTH_REDIRECT_URI");
    requiredEnv("LINEAR_CONNECT_URL");
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(32));
    const challenge = await sha256(verifier);
    const result = await ctx.runMutation(internal.linear.startOAuthInternal, {
      requestId, stateHash: await sha256(state), verifier
    });
    const url = new URL(LINEAR_AUTH);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "read,write,issues:create");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString(), expiresAt: result.expiresAt };
  }
});

export const startOAuthInternal = internalMutation({
  args: { requestId: v.string(), stateHash: v.string(), verifier: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.db.query("oauthRequests").withIndex("by_request_id", (q) => q.eq("requestId", args.requestId)).unique();
    if (!request || request.status !== "pending" || request.expiresAt <= Date.now()) fail("linear_auth_expired", "The connection request has expired. Start a new login.");
    await ctx.db.patch(request._id, { status: "oauth_started", stateHash: args.stateHash, pkceVerifier: args.verifier });
    return { expiresAt: request.expiresAt };
  }
});

export const pollCliAuth = action({
  args: { requestId: v.string(), pollSecret: v.string() },
  handler: async (ctx, args) => {
    const requestId = safeRequestId(args.requestId);
    if (args.pollSecret.length < 32 || args.pollSecret.length > 256) fail("linear_auth_invalid", "Invalid poll secret.");
    const sessionToken = await sessionTokenForRequest(requestId);
    return ctx.runMutation(internal.linear.pollCliAuthInternal, {
      requestId, pollSecretHash: await sha256Hex(args.pollSecret), sessionToken, sessionTokenHash: await sha256(sessionToken)
    });
  }
});

export const pollCliAuthInternal = internalMutation({
  args: { requestId: v.string(), pollSecretHash: v.string(), sessionToken: v.string(), sessionTokenHash: v.string() },
  handler: async (ctx, { requestId, pollSecretHash, sessionToken, sessionTokenHash }) => {
    const request = await ctx.db.query("oauthRequests").withIndex("by_request_id", (q) => q.eq("requestId", requestId)).unique();
    if (!request || !constantTimeEqual(request.pollSecretHash, pollSecretHash)) fail("linear_auth_invalid", "The connection request or poll secret is invalid.");
    if (request.expiresAt <= Date.now()) fail("linear_auth_expired", "The connection request has expired. Start a new login.");
    if (request.status === "failed") fail("linear_auth_failed", "Linear authorization did not complete. Start a new login.");
    if (request.status !== "complete" || !request.connectionId || !request.sessionExpiresAt || request.deliveredAt) return { status: "pending" as const };
    const session = await ctx.db.query("cliSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", sessionTokenHash)).unique();
    if (!session || session.connectionId !== request.connectionId || session.expiresAt !== request.sessionExpiresAt) fail("linear_auth_failed", "The one-time session could not be delivered.");
    await ctx.db.patch(request._id, { deliveredAt: Date.now() });
    return { status: "complete" as const, sessionToken, expiresAt: request.sessionExpiresAt };
  }
});


export const revokeCliSession = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    if (sessionToken.length < 20 || sessionToken.length > 512) fail("linear_auth_invalid", "Invalid nstack session token.");
    await ctx.runMutation(internal.linear.revokeSessionInternal, { tokenHash: await sha256(sessionToken) });
    return { revoked: true as const };
  }
});

export const revokeSessionInternal = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("cliSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (session && !session.revokedAt) await ctx.db.patch(session._id, { revokedAt: Date.now() });
  }
});

export const claimOAuthCallback = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, { stateHash }) => {
    const request = await ctx.db.query("oauthRequests").withIndex("by_state_hash", (q) => q.eq("stateHash", stateHash)).unique();
    if (!request || request.status !== "oauth_started" || request.expiresAt <= Date.now() || request.callbackClaimedAt) return null;
    await ctx.db.patch(request._id, { status: "exchanging", callbackClaimedAt: Date.now() });
    return { requestId: request.requestId, verifier: request.pkceVerifier!, expiresAt: request.expiresAt };
  }
});

export const finishOAuth = internalMutation({
  args: {
    requestId: v.string(), accountRef: v.string(), encryptedAccessToken: v.string(), encryptedRefreshToken: v.optional(v.string()),
    scopes: v.array(v.string()), accessTokenExpiresAt: v.number(), sessionTokenHash: v.string()
  },
  handler: async (ctx, data) => {
    const request = await ctx.db.query("oauthRequests").withIndex("by_request_id", (q) => q.eq("requestId", data.requestId)).unique();
    if (!request || request.status !== "exchanging" || request.expiresAt <= Date.now()) fail("linear_auth_expired", "The connection request expired before authorization completed.");
    const now = Date.now();
    const connectionId = await ctx.db.insert("linearConnections", {
      accountRef: data.accountRef, encryptedAccessToken: data.encryptedAccessToken,
      ...(data.encryptedRefreshToken ? { encryptedRefreshToken: data.encryptedRefreshToken } : {}),
      scopes: data.scopes, accessTokenExpiresAt: data.accessTokenExpiresAt, createdAt: now, updatedAt: now
    });
    const sessionExpiresAt = now + SESSION_TTL;
    await ctx.db.insert("cliSessions", { tokenHash: data.sessionTokenHash, connectionId, expiresAt: sessionExpiresAt, createdAt: now });
    await ctx.db.patch(request._id, { status: "complete", connectionId, sessionExpiresAt, pkceVerifier: undefined });
    return { sessionExpiresAt };
  }
});

export const failOAuth = internalMutation({
  args: { requestId: v.string(), failureCode: v.string() },
  handler: async (ctx, { requestId, failureCode }) => {
    const request = await ctx.db.query("oauthRequests").withIndex("by_request_id", (q) => q.eq("requestId", requestId)).unique();
    if (request && request.status !== "complete") await ctx.db.patch(request._id, { status: "failed", failureCode, pkceVerifier: undefined });

  }
});

export const getSession = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("cliSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!session || session.revokedAt || session.expiresAt <= Date.now()) return null;
    const connection = await ctx.db.get(session.connectionId);
    if (!connection) return null;
    return {
      connectionId: connection._id, encryptedAccessToken: connection.encryptedAccessToken,
      ...(connection.encryptedRefreshToken ? { encryptedRefreshToken: connection.encryptedRefreshToken } : {}),
      accessTokenExpiresAt: connection.accessTokenExpiresAt
    };
  }
});

export const rotateConnection = internalMutation({
  args: { connectionId: v.id("linearConnections"), encryptedAccessToken: v.string(), encryptedRefreshToken: v.optional(v.string()), accessTokenExpiresAt: v.number() },
  handler: async (ctx, { connectionId, ...tokens }) => {
    const connection = await ctx.db.get(connectionId);
    if (!connection) fail("linear_auth_expired", "The Linear connection no longer exists; sign in again.");
    await ctx.db.patch(connectionId, { ...tokens, updatedAt: Date.now() });
  }
});

async function tokenResponse(response: Response): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || !isRecord(body)) fail("linear_auth_expired", "Linear authorization failed. Sign in again.");
  return body;
}


async function handleOAuthCallback(ctx: ActionCtx, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const connectBase = requiredEnv("LINEAR_CONNECT_URL").replace(/\/$/, "");
  const returnTo = (result: "approved" | "denied", requestId?: string) => {
    const destination = new URL(`${connectBase}/linear/connect`);
    if (requestId) destination.searchParams.set("requestId", requestId);
    destination.searchParams.set("result", result);
    return Response.redirect(destination.toString(), 303);
  };
  if (!state) return returnTo("denied");
  let claimed: { requestId: string; verifier: string; expiresAt: number } | null;
  try {
    claimed = await ctx.runMutation(internal.linear.claimOAuthCallback, { stateHash: await sha256(state) });
  } catch {
    return returnTo("denied");
  }
  if (!claimed) return returnTo("denied");
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (providerError || !code || claimed.expiresAt <= Date.now()) {
    await ctx.runMutation(internal.linear.failOAuth, { requestId: claimed.requestId, failureCode: "consent_denied" });
    return returnTo("denied", claimed.requestId);
  }
  try {
    const clientId = requiredEnv("LINEAR_OAUTH_CLIENT_ID");
    const clientSecret = requiredEnv("LINEAR_OAUTH_CLIENT_SECRET");
    const redirectUri = requiredEnv("LINEAR_OAUTH_REDIRECT_URI");
    const tokenBody = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: claimed.verifier });
    const tokens = await tokenResponse(await fetch(LINEAR_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: tokenBody.toString() }));
    if (typeof tokens.access_token !== "string") fail("linear_auth_failed", "Linear did not return an access token.");
    const accessToken = tokens.access_token;
    const viewerData = await linearFetch(accessToken, "query NstackViewer { viewer { id } }");
    const viewer = isRecord(viewerData.viewer) ? viewerData.viewer : {};
    if (typeof viewer.id !== "string") fail("linear_auth_failed", "Linear did not return an account reference.");
    const sessionToken = await sessionTokenForRequest(claimed.requestId);
    const scopes = typeof tokens.scope === "string" ? tokens.scope.split(/[ ,]+/).filter(Boolean) : ["read", "write", "issues:create"];
    const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : 60 * 60 * 24 * 30;
    await ctx.runMutation(internal.linear.finishOAuth, {
      requestId: claimed.requestId,
      accountRef: await sha256(`linear-account:${viewer.id}`),
      encryptedAccessToken: await encryptToken(accessToken),
      ...(typeof tokens.refresh_token === "string" ? { encryptedRefreshToken: await encryptToken(tokens.refresh_token) } : {}),
      scopes, accessTokenExpiresAt: Date.now() + expiresIn * 1000, sessionTokenHash: await sha256(sessionToken)
    });
    return returnTo("approved", claimed.requestId);
  } catch {
    await ctx.runMutation(internal.linear.failOAuth, { requestId: claimed.requestId, failureCode: "token_exchange_failed" });
    return returnTo("denied", claimed.requestId);
  }
}

export const oauthCallback = httpAction((ctx, request) => handleOAuthCallback(ctx, request));


type NormalizedArgs = {
  id?: string; current?: boolean; team?: string; title?: string; description?: string; body?: string;
  state?: string; assignee?: string | null; priority?: string | number; estimate?: number | null;
  dueDate?: string | null; labels?: string[]; project?: string | null; parentId?: string | null;
  parentCurrent?: boolean; writeId?: string; workspace?: string; comments?: boolean;
  children?: boolean; depth?: number; attachments?: boolean; relations?: boolean;
  activity?: boolean; full?: boolean; query?: string; limit?: number; filter?: string;
  cycle?: string; label?: string; cursor?: string; orderBy?: string; release?: string;
  delegate?: string; createdAt?: string; updatedAt?: string; includeArchived?: boolean;
  related?: string; type?: string; to?: string; url?: string; replyTo?: string;
};


const ARGS_VALIDATOR = v.object({
  id: v.optional(v.string()), current: v.optional(v.boolean()), team: v.optional(v.string()),
  title: v.optional(v.string()), description: v.optional(v.string()), state: v.optional(v.string()),
  assignee: v.optional(v.union(v.string(), v.null())), priority: v.optional(v.union(v.string(), v.number())),
  estimate: v.optional(v.union(v.number(), v.null())), dueDate: v.optional(v.union(v.string(), v.null())),
  labels: v.optional(v.array(v.string())), project: v.optional(v.union(v.string(), v.null())),
  parentId: v.optional(v.union(v.string(), v.null())), parentCurrent: v.optional(v.boolean()),
  writeId: v.optional(v.string()), workspace: v.optional(v.string()), comments: v.optional(v.boolean()),
  children: v.optional(v.boolean()), depth: v.optional(v.number()), attachments: v.optional(v.boolean()),
  relations: v.optional(v.boolean()), activity: v.optional(v.boolean()), full: v.optional(v.boolean()),
  query: v.optional(v.string()), limit: v.optional(v.number()), filter: v.optional(v.string()),
  cycle: v.optional(v.string()), label: v.optional(v.string()), cursor: v.optional(v.string()),
  orderBy: v.optional(v.string()), release: v.optional(v.string()), delegate: v.optional(v.string()),
  createdAt: v.optional(v.string()), updatedAt: v.optional(v.string()), includeArchived: v.optional(v.boolean()),
  related: v.optional(v.string()), type: v.optional(v.string()), to: v.optional(v.string()),
  url: v.optional(v.string()), replyTo: v.optional(v.string()), body: v.optional(v.string())
});

const OPERATION_FIELDS: Record<string, readonly string[]> = {
  "issue.get": ["id", "workspace", "comments", "children", "depth", "attachments", "relations", "activity", "full"],
  "issue.search": ["query", "limit", "cursor", "workspace"],
  "issue.list": ["filter", "team", "limit", "cursor", "workspace"],
  "issue.listIssues": ["team", "cycle", "label", "limit", "query", "state", "cursor", "orderBy", "project", "release", "assignee", "delegate", "parentId", "priority", "createdAt", "updatedAt", "includeArchived", "workspace"],
  "team.list": ["cursor", "workspace"], "team.members": ["team", "cursor", "workspace"], "team.states": ["team", "cursor", "workspace"],
  "team.labels": ["team", "cursor", "workspace"], "project.list": ["query", "limit", "cursor", "workspace"],
  "issue.save": ["id", "current", "team", "title", "description", "state", "assignee", "priority", "estimate", "dueDate", "labels", "project", "parentId", "writeId", "workspace"],
  "issue.create": ["team", "title", "description", "state", "assignee", "priority", "estimate", "dueDate", "labels", "project", "parentId", "parentCurrent", "writeId", "workspace"],
  "relation.add": ["id", "current", "related", "type", "workspace"], "relation.remove": ["id", "current", "related", "type", "workspace"],
  "status.set": ["id", "current", "to", "workspace"], "assignee.set": ["id", "current", "to", "workspace"],
  "assignee.clear": ["id", "current", "workspace"], "priority.set": ["id", "current", "to", "workspace"],
  "priority.clear": ["id", "current", "workspace"], "estimate.set": ["id", "current", "to", "workspace"],
  "estimate.clear": ["id", "current", "workspace"], "dueDate.set": ["id", "current", "to", "workspace"],
  "dueDate.clear": ["id", "current", "workspace"], "label.add": ["id", "current", "labels", "workspace"],
  "label.remove": ["id", "current", "labels", "workspace"], "label.set": ["id", "current", "labels", "workspace"],
  "comment.add": ["id", "current", "body", "replyTo", "writeId", "workspace"],
  "attachment.add": ["id", "current", "url", "title", "writeId", "workspace"]
};

function isValidCalendarDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function validateOperationArgs(operation: string, args: NormalizedArgs): void {
  for (const key of Object.keys(args)) {
    if (!OPERATION_FIELDS[operation]?.includes(key)) fail("linear_invalid_arguments", `Argument ${key} is not valid for ${operation}.`);
  }
  const requireText = (key: keyof NormalizedArgs, max = 2_000) => {
    const value = args[key];
    if (typeof value !== "string" || !value.trim() || value.length > max) fail("linear_invalid_arguments", `${key} is required and must be a non-empty string.`);
  };
  const requireIssue = () => requireText("id", 200);
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1)) fail("linear_invalid_arguments", "limit must be a positive integer.");
  if (args.cursor !== undefined) {
    requireText("cursor", 2_048);
    if (!args.workspace || args.workspace === "all") fail("linear_invalid_workspace", "A concrete workspace is required to continue a cursor.");
  }
  if (operation === "issue.get") requireIssue();
  if (operation === "issue.search") requireText("query");
  if (operation === "issue.list" && args.filter && !["assigned", "created", "all", "completed", "open"].includes(args.filter)) fail("linear_invalid_arguments", "Invalid issue list filter.");
  if (operation === "issue.listIssues" && args.priority !== undefined && (typeof args.priority !== "number" || !Number.isInteger(args.priority) || args.priority < 0 || args.priority > 4)) fail("linear_invalid_arguments", "Priority must be an integer from 0 to 4.");
  if (["team.members", "team.states", "team.labels"].includes(operation)) requireText("team");
  if (operation === "issue.create" || (operation === "issue.save" && !args.id)) {
    if (args.team !== undefined) requireText("team");
    requireText("title", 255);
  }
  if (args.title !== undefined && (!args.title.trim() || args.title.length > 255)) fail("linear_invalid_arguments", "Title must contain 1 to 255 characters.");
  if (operation === "issue.save" && args.id) requireIssue();
  if (operation.startsWith("relation.")) {
    requireIssue(); requireText("related", 200); requireText("type", 32);
    if (!["blocks", "blocked-by", "related", "duplicate-of"].includes(args.type!)) fail("linear_invalid_arguments", "Invalid relation type.");
  }
  if (["status.set", "assignee.set", "priority.set", "estimate.set", "dueDate.set"].includes(operation)) {
    requireIssue(); requireText("to", operation === "dueDate.set" ? 32 : 255);
  }
  if (operation.endsWith(".clear")) requireIssue();
  if (["label.add", "label.remove", "label.set"].includes(operation)) {
    requireIssue();
    if (!args.labels?.length || args.labels.some((label) => !label.trim() || label.length > 255)) fail("linear_invalid_label", "At least one valid label is required.");
  }
  if (operation === "comment.add") {
    requireIssue();
    if (typeof args.body !== "string" || !args.body.trim() || args.body.length > MAX_COMMENT) fail("linear_invalid_arguments", `Comment body must be between 1 and ${MAX_COMMENT} characters.`);
  }
  if (operation === "attachment.add") {
    requireIssue();
    if (typeof args.url !== "string" || args.url.length > 2_048) fail("linear_invalid_arguments", "Attachment URL is required.");
    let parsed: URL;
    try { parsed = new URL(args.url); } catch { fail("linear_invalid_arguments", "Attachment URL must be absolute HTTP(S)."); }
    if (!["http:", "https:"].includes(parsed.protocol)) fail("linear_invalid_arguments", "Attachment URL must be absolute HTTP(S).");
  }
  if (args.description !== undefined && args.description.length > MAX_BODY) fail("linear_invalid_arguments", `Description exceeds ${MAX_BODY} characters.`);
  if (args.labels !== undefined && (args.labels.length > 100 || args.labels.some((label) => !label.trim() || label.length > 255))) fail("linear_invalid_label", "Labels must contain at most 100 non-empty names or IDs of 255 characters or fewer.");
  if (args.estimate !== undefined && args.estimate !== null && (!Number.isInteger(args.estimate) || args.estimate < 0)) fail("linear_invalid_arguments", "Estimate must be a non-negative integer or null.");
  if (operation === "estimate.set" && (!Number.isInteger(Number(args.to)) || Number(args.to) < 0)) fail("linear_invalid_arguments", "Estimate must be a non-negative integer.");
  if (args.dueDate !== undefined && args.dueDate !== null && !isValidCalendarDate(args.dueDate)) fail("linear_invalid_arguments", "Due date must be a real YYYY-MM-DD date.");
  if (operation === "dueDate.set" && !isValidCalendarDate(args.to!)) fail("linear_invalid_arguments", "Due date must be a real YYYY-MM-DD date.");
  if (args.priority !== undefined && operation !== "issue.listIssues") priorityNumber(args.priority);
  if (args.writeId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.writeId)) fail("linear_invalid_arguments", "writeId must be a UUID.");
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 250)) fail("linear_invalid_arguments", "limit must be an integer from 1 to 250.");
  if (args.depth !== undefined && (!Number.isInteger(args.depth) || args.depth < 0 || args.depth > 5 || (!args.children && !args.full))) fail("linear_invalid_arguments", "depth requires children or full and must be from 0 to 5.");
  if (args.workspace === "all" && (operation === "issue.get" || WRITE_OPERATIONS.has(operation))) fail("linear_invalid_workspace", "Workspace `all` is not valid for this operation.");
}

type Entity = Record<string, unknown>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function getRecord(value: unknown, label = "Linear response"): Record<string, unknown> {
  if (!isRecord(value)) fail("linear_network", `${label} was malformed.`);
  return value;
}
function getNodes(value: unknown): Entity[] {
  const record = isRecord(value) ? value : {};
  return Array.isArray(record.nodes) ? record.nodes.filter(isRecord) : [];
}
function entityText(entity: Entity, key: string): string | undefined {
  return typeof entity[key] === "string" ? entity[key] as string : undefined;
}
function exactEntity(rows: Entity[], selector: string, code: string, label: string): Entity {
  const matches = rows.filter((row) => [row.id, row.identifier, row.key, row.name, row.email].some((value) => value === selector));
  if (matches.length !== 1) fail(`linear_invalid_${code}`, matches.length ? `${label} selector is ambiguous; use its stable ID.` : `${label} was not found; use an exact name or stable ID.`);
  return matches[0];
}

async function linearFetch(token: string, queryText: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(LINEAR_API, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: queryText, variables })
    });
  } catch {
    fail("linear_network", "Could not reach Linear. Check the network and retry.");
  }
  if (response.status === 429) fail("linear_rate_limited", "Linear rate limit reached. Wait before retrying.");
  if (response.status === 401) fail("linear_auth_expired", "Linear authentication expired. Sign in again.");
  if (response.status === 403) fail("linear_permission_denied", "Linear denied this operation.");
  if (response.status >= 500) fail("linear_network", "Linear returned a server error; the request outcome may be uncertain.");
  let parsed: unknown;
  try { parsed = await response.json(); } catch { fail("linear_network", "Linear returned an unreadable response."); }
  const body = getRecord(parsed);
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (!response.ok || errors.length) {
    const error = isRecord(errors[0]) ? errors[0] : {};
    const message = typeof error.message === "string" ? error.message : "";
    if (/permission|forbidden/i.test(message)) fail("linear_permission_denied", "Linear denied this operation.");
    if (/rate limit/i.test(message)) fail("linear_rate_limited", "Linear rate limit reached. Wait before retrying.");
    fail("linear_request_failed", "Linear rejected this request. Review the selected issue and fields.");
  }
  return getRecord(body.data);
}

async function authorizedToken(ctx: ActionCtx, sessionToken?: string, apiKey?: string): Promise<string> {
  if (apiKey !== undefined) {
    if (apiKey.length < 8 || apiKey.length > 512) fail("linear_auth_invalid", "The Linear API key is invalid.");
    return apiKey;
  }
  if (!sessionToken) fail("linear_not_connected", "No Linear session is configured. Run `nstack linear auth login` or set LINEAR_API_KEY.");
  const session = await ctx.runQuery(internal.linear.getSession, { tokenHash: await sha256(sessionToken) });
  if (!session) fail("linear_auth_expired", "The nstack Linear session is expired or revoked. Run `nstack linear auth login`.");
  let accessToken = await decryptToken(session.encryptedAccessToken);
  if (session.accessTokenExpiresAt <= Date.now() + 60_000) {
    if (!session.encryptedRefreshToken) fail("linear_auth_expired", "The Linear access token expired. Run `nstack linear auth login`.");
    const refreshToken = await decryptToken(session.encryptedRefreshToken);
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: requiredEnv("LINEAR_OAUTH_CLIENT_ID"), client_secret: requiredEnv("LINEAR_OAUTH_CLIENT_SECRET") });
    let refreshed: Record<string, unknown>;
    try {
      const response = await fetch(LINEAR_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
      refreshed = await tokenResponse(response);
    } catch {
      fail("linear_auth_expired", "The Linear session could not be refreshed. Run `nstack linear auth login`.");
    }
    if (typeof refreshed.access_token !== "string") fail("linear_auth_expired", "The Linear session could not be refreshed. Run `nstack linear auth login`.");
    accessToken = refreshed.access_token;
    const nextRefresh = typeof refreshed.refresh_token === "string" ? refreshed.refresh_token : refreshToken;
    const expiresIn = typeof refreshed.expires_in === "number" ? refreshed.expires_in : 3600;
    await ctx.runMutation(internal.linear.rotateConnection, {
      connectionId: session.connectionId, encryptedAccessToken: await encryptToken(accessToken),
      encryptedRefreshToken: await encryptToken(nextRefresh), accessTokenExpiresAt: Date.now() + expiresIn * 1000
    });
  }
  return accessToken;
}

const ISSUE_FIELDS = `
  id identifier title description url priority estimate dueDate createdAt updatedAt completedAt canceledAt
  assignee { id name email } creator { id name } team { id key name } project { id name }
  cycle { id name } state { id name type } parent { id identifier title }
  labels(first: 100) { nodes { id name } pageInfo { hasNextPage endCursor } }
`;
const CHILD_PAGE_LIMIT: Record<number, number> = { 1: 200, 2: 13, 3: 5, 4: 3, 5: 2 };

function issueSelection(args: NormalizedArgs, depth: number, childLimit = CHILD_PAGE_LIMIT[depth] ?? 200): string {
  const fields: string[] = [ISSUE_FIELDS];
  if (args.comments || args.full) fields.push("comments(first: 500) { nodes { id body createdAt user { id name } parent { id } } pageInfo { hasNextPage endCursor } }");
  if (args.attachments || args.full) fields.push("attachments(first: 100) { nodes { id title url subtitle sourceType createdAt } pageInfo { hasNextPage endCursor } }");
  if (args.relations || args.full) fields.push("relations(first: 100) { nodes { id type relatedIssue { id identifier title url } } pageInfo { hasNextPage endCursor } }");
  if (args.activity || args.full) fields.push("history(first: 250) { nodes { id createdAt fromState { id name } toState { id name } actor { id name } } pageInfo { hasNextPage endCursor } }");
  if ((args.children || args.full) && depth > 0) {
    const nestedArgs: NormalizedArgs = { depth: depth - 1, children: depth > 1 };
    fields.push(`children(first: ${childLimit}) { nodes { ${issueSelection(nestedArgs, depth - 1, childLimit)} } pageInfo { hasNextPage endCursor } }`);
  }
  return fields.join("\n");
}

async function fetchWorkspace(token: string, workspace?: string): Promise<Entity | undefined> {
  const data = await linearFetch(token, "query NstackOrganization { organization { id name url } }");
  const organization = isRecord(data.organization) ? data.organization : undefined;
  if (workspace && workspace !== "all" && (!organization || ![organization.id, organization.name].includes(workspace))) {
    fail("linear_invalid_workspace", "The selected workspace is not available to this Linear connection.");
  }
  return organization;
}
async function fetchEntities(token: string, queryText: string, root: string): Promise<Entity[]> {
  const data = await linearFetch(token, queryText);
  return getNodes(data[root]);
}
async function resolveTeam(token: string, selector?: string): Promise<Entity> {
  if (!selector) fail("linear_invalid_team", "Specify a team by exact name, key, or ID.");
  const teams = await fetchEntities(token, "query NstackTeams { teams(first: 250) { nodes { id key name } } }", "teams");
  return exactEntity(teams, selector, "team", "Team");
}
function entityId(entity: Entity, label: string): string {
  const id = entityText(entity, "id");
  if (!id) fail("linear_network", `${label} response did not contain an ID.`);
  return id;
}
async function resolveState(token: string, selector: string, teamId?: string): Promise<Entity> {
  if (!teamId) fail("linear_invalid_state", "A team is required to resolve a workflow state.");
  const data = await linearFetch(token, "query NstackStates($teamId: String!) { workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 250) { nodes { id name type } } }", { teamId });
  return exactEntity(getNodes(data.workflowStates), selector, "state", "Workflow state");
}


async function resolveUser(token: string, selector: string | null | undefined): Promise<string | null | undefined> {
  if (selector === undefined) return undefined;
  if (selector === null) return null;
  if (selector === "me") {
    const data = await linearFetch(token, "query NstackViewer { viewer { id } }");
    return entityId(getRecord(data.viewer), "Viewer");
  }
  const users = await fetchEntities(token, "query NstackUsers { users(first: 250) { nodes { id name email } } }", "users");
  return entityId(exactEntity(users, selector, "assignee", "Assignee"), "Assignee");
}
async function resolveLabelIds(token: string, selectors: string[], teamId?: string): Promise<string[]> {
  const queryText = teamId
    ? "query NstackLabels($teamId: String!) { issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 250) { nodes { id name } } }"
    : "query NstackLabels { issueLabels(first: 250) { nodes { id name } } }";
  const data = await linearFetch(token, queryText, teamId ? { teamId } : {});
  const labels = getNodes(data.issueLabels);
  return selectors.map((selector) => entityId(exactEntity(labels, selector, "label", "Label"), "Label"));
}
async function resolveProject(token: string, selector: string | null | undefined): Promise<string | null | undefined> {
  if (selector === undefined) return undefined;
  if (selector === null) return null;
  const projects = await fetchEntities(token, "query NstackProjects { projects(first: 250) { nodes { id name } } }", "projects");
  return entityId(exactEntity(projects, selector, "project", "Project"), "Project");
}
async function resolveCycle(token: string, selector: string, teamId?: string): Promise<string> {
  const queryText = teamId
    ? "query NstackCycles($teamId: String!) { cycles(filter: { team: { id: { eq: $teamId } } }, first: 250) { nodes { id name number } } }"
    : "query NstackCycles { cycles(first: 250) { nodes { id name number } } }";
  const data = await linearFetch(token, queryText, teamId ? { teamId } : {});
  return entityId(exactEntity(getNodes(data.cycles), selector, "state", "Cycle"), "Cycle");
}
async function resolveRelease(token: string, selector: string): Promise<string> {
  const data = await linearFetch(token, "query NstackMilestones { projectMilestones(first: 250) { nodes { id name project { id name } } } }");
  return entityId(exactEntity(getNodes(data.projectMilestones), selector, "project", "Release"), "Release");
}

async function resolveIssueId(token: string, selector: string | null | undefined, code = "parent"): Promise<string | null | undefined> {
  if (selector === undefined) return undefined;
  if (selector === null) return null;
  const data = await linearFetch(token, "query NstackFindIssue($query: String!) { issueSearch(query: $query, first: 10) { nodes { id identifier title } } }", { query: selector });
  return entityId(exactEntity(getNodes(data.issueSearch), selector, code, "Issue"), "Issue");
}

function priorityNumber(value: string | number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4) return value;
  const priorities: Record<string, number> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };
  if (typeof value === "string" && priorities[value.toLowerCase()] !== undefined) return priorities[value.toLowerCase()];
  fail("linear_invalid_arguments", "Priority must be none, urgent, high, medium, low, or 0 through 4.");
}
function cleanIssueInput(input: Record<string, unknown>, args: NormalizedArgs): void {
  if (args.title !== undefined) input.title = args.title;
  if (args.description !== undefined) input.description = args.description;
  if (args.priority !== undefined) input.priority = priorityNumber(args.priority);
  if (args.estimate !== undefined) input.estimate = args.estimate;
  if (args.dueDate !== undefined) input.dueDate = args.dueDate;
  if (args.parentId !== undefined) input.parentId = args.parentId;
}
async function createOrUpdateIssue(token: string, args: NormalizedArgs, create: boolean): Promise<unknown> {
  let team: Entity | undefined;
  if (args.team) {
    team = await resolveTeam(token, args.team);
  } else if (create) {
    const teams = await fetchEntities(token, "query NstackTeams { teams(first: 2) { nodes { id key name } } }", "teams");
    if (teams.length !== 1) fail("linear_invalid_team", "Specify a team unless this workspace has exactly one team.");
    team = teams[0];
  }
  let teamId = team ? entityId(team, "Team") : undefined;
  const input: Record<string, unknown> = {};
  if (teamId) input.teamId = teamId;
  cleanIssueInput(input, args);
  if (args.state) {
    if (!teamId) {
      const existing = await findIssue(token, args.id!, "id team { id }");
      teamId = isRecord(existing.team) ? entityText(existing.team, "id") : undefined;
    }
    input.stateId = entityId(await resolveState(token, args.state, teamId), "State");
  }
  if (args.assignee !== undefined) input.assigneeId = await resolveUser(token, args.assignee);
  if (args.project !== undefined) input.projectId = await resolveProject(token, args.project);
  if (args.parentId !== undefined) input.parentId = await resolveIssueId(token, args.parentId);
  if (args.labels !== undefined) input.labelIds = await resolveLabelIds(token, args.labels, teamId);
  if (args.writeId) input.clientMutationId = args.writeId;
  if (create) {
    const result = await linearFetch(token, `mutation NstackIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } } }`, { input });
    return result.issueCreate;
  }
  const issueId = await resolveIssueId(token, args.id, "parent");
  const result = await linearFetch(token, `mutation NstackIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`, { id: issueId, input });
  return result.issueUpdate;
}


async function findIssue(token: string, id: string, fields = ISSUE_FIELDS): Promise<Entity> {
  const data = await linearFetch(token, `query NstackIssue($id: String!) { issue(id: $id) { ${fields} } }`, { id });
  if (!isRecord(data.issue)) fail("linear_issue_required", `Linear issue ${id} was not found.`);
  return data.issue;
}
async function mutateIssue(token: string, id: string, input: Record<string, unknown>, writeId?: string): Promise<unknown> {
  if (writeId) input.clientMutationId = writeId;
  const data = await linearFetch(token, `mutation NstackIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`, { id, input });
  return data.issueUpdate;
}
async function resolveForIssueMutation(token: string, args: NormalizedArgs): Promise<string> {
  if (!args.id) fail("linear_issue_required", "Specify an issue ID; current issue context is unavailable to the service.");
  return entityId(await findIssue(token, args.id, "id"), "Issue");
}
function pageMetadata(result: Record<string, unknown>, limit: number | null): Record<string, unknown> {
  const pageInfo = isRecord(result.pageInfo) ? result.pageInfo : {};
  return {
    limit,
    hasMore: pageInfo.hasNextPage === true,
    ...(typeof pageInfo.endCursor === "string" ? { nextCursor: pageInfo.endCursor } : {})
  };
}
function pagedResult(name: string, result: Record<string, unknown>, limit: number | null): Record<string, unknown> {
  return {
    [name]: getNodes(result),
    pageInfo: isRecord(result.pageInfo) ? result.pageInfo : { hasNextPage: false, endCursor: null },
    meta: pageMetadata(result, limit)
  };
}
const PAGED_SECTIONS: Record<string, true> = { labels: true, comments: true, children: true, attachments: true, relations: true, history: true };
function sectionCaps(value: unknown, path = "issue", caps: string[] = [], depth = 0): string[] {
  if (depth > 12 || !isRecord(value)) return caps;
  for (const [key, child] of Object.entries(value)) {
    if (key === "pageInfo" || !isRecord(child)) continue;
    const nextPath = `${path}.${key}`;
    if (PAGED_SECTIONS[key] && isRecord(child.pageInfo) && child.pageInfo.hasNextPage === true) caps.push(nextPath);
    sectionCaps(child, nextPath, caps, depth + 1);
  }
  return caps;
}
function collectInlineMedia(issue: Entity): Array<{ source: string; alt: string; url: string; title?: string }> {
  const media: Array<{ source: string; alt: string; url: string; title?: string }> = [];
  const image = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+["']([^"']*)["'])?\)/g;
  const scan = (body: unknown, source: string) => {
    if (typeof body !== "string") return;
    for (const match of body.matchAll(image)) {
      try {
        const url = new URL(match[2]);
        if (url.protocol === "http:" || url.protocol === "https:") {
          media.push({ source, alt: match[1], url: url.toString(), ...(match[3] ? { title: match[3] } : {}) });
        }
      } catch { /* Invalid links are not inline media. */ }
    }
  };
  const visit = (current: unknown, source: string, depth: number) => {
    if (!isRecord(current) || depth > 5) return;
    scan(current.description, `${source}.description`);
    for (const [index, comment] of getNodes(current.comments).entries()) {
      if (isRecord(comment)) scan(comment.body, `${source}.comments[${index}].body`);
    }
    for (const [index, child] of getNodes(current.children).entries()) visit(child, `${source}.children[${index}]`, depth + 1);
  };
  visit(issue, "issue", 0);
  return media;
}
function issueDetails(issue: Entity): Record<string, unknown> {
  const caps = sectionCaps(issue);
  return {
    issue,
    inlineMedia: collectInlineMedia(issue),
    meta: { partial: caps.length > 0, sectionCaps: caps }
  };
}

function connectionResult(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const result = isRecord(data[key]) ? data[key] : {};
  return {
    nodes: getNodes(result),
    pageInfo: isRecord(result.pageInfo) ? result.pageInfo : { hasNextPage: false, endCursor: null }
  };
}

async function issueFilters(token: string, args: NormalizedArgs): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};
  const team = args.team ? await resolveTeam(token, args.team) : undefined;
  const teamId = team ? entityId(team, "Team") : undefined;
  if (teamId) filter.team = { id: { eq: teamId } };
  if (args.state) filter.state = { id: { eq: entityId(await resolveState(token, args.state, teamId), "State") } };
  if (args.assignee !== undefined) {
    const id = await resolveUser(token, args.assignee);
    filter.assignee = id ? { id: { eq: id } } : { null: true };
  }
  if (args.delegate) filter.delegate = { id: { eq: await resolveUser(token, args.delegate) } };
  if (args.cycle) filter.cycle = { id: { eq: await resolveCycle(token, args.cycle, teamId) } };
  if (args.project) {
    const project = await resolveProject(token, args.project);
    if (project) filter.project = { id: { eq: project } };
  }
  if (args.parentId !== undefined) {
    const parent = await resolveIssueId(token, args.parentId);
    filter.parent = parent ? { id: { eq: parent } } : { null: true };
  }
  if (args.label) filter.labels = { id: { eq: (await resolveLabelIds(token, [args.label], teamId))[0] } };
  if (args.priority !== undefined) filter.priority = { eq: priorityNumber(args.priority) };
  if (!args.includeArchived) filter.archivedAt = { null: true };
  if (args.createdAt) filter.createdAt = { gte: toDate(args.createdAt) };
  if (args.updatedAt) filter.updatedAt = { gte: toDate(args.updatedAt) };
  if (args.query) filter.title = { containsIgnoreCase: args.query };
  if (args.release) filter.projectMilestone = { id: { eq: await resolveRelease(token, args.release) } };
  return filter;
}
function toDate(value: string): string {
  const duration = /^(\d+)([smhdw])$/i.exec(value);
  if (duration) {
    const units: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
    const milliseconds = Number(duration[1]) * units[duration[2].toLowerCase()];
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) fail("linear_invalid_arguments", "Duration filters must be positive and finite.");
    return new Date(Date.now() - milliseconds).toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail("linear_invalid_arguments", "Date filters must be valid ISO date/time strings or durations such as 7d.");
  return parsed.toISOString();
}


async function executeLinearOperation(token: string, operation: string, args: NormalizedArgs): Promise<unknown> {
  if (args.workspace && args.workspace !== "all") await fetchWorkspace(token, args.workspace);
  const first = Math.min(args.limit ?? (operation === "issue.search" ? 20 : 250), operation === "issue.search" ? 50 : 250);
  if (operation === "issue.get") {
    const depth = args.depth ?? ((args.children || args.full) ? 2 : 0);
    const data = await linearFetch(token, `query NstackIssue($id: String!) { issue(id: $id) { ${issueSelection(args, depth)} } }`, { id: args.id });
    if (!data.issue) fail("linear_issue_required", `Linear issue ${args.id} was not found.`);
    return issueDetails(getRecord(data.issue));
  }
  if (operation === "issue.search") {
    const data = await linearFetch(token, `query NstackSearch($query: String!, $first: Int!, $after: String) { issueSearch(query: $query, first: $first, after: $after) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`, { query: args.query, first, after: args.cursor ?? null });
    const connection = connectionResult(data, "issueSearch");
    return { ...pagedResult("issues", { nodes: connection.nodes, pageInfo: connection.pageInfo }, first) };
  }
  if (operation === "issue.list" || operation === "issue.listIssues") {
    const filter = await issueFilters(token, args);
    if (operation === "issue.list") {
      const filterName = args.filter ?? "assigned";
      if (filterName === "assigned") filter.assignee = { id: { eq: entityId(getRecord((await linearFetch(token, "query NstackViewer { viewer { id } }")).viewer), "Viewer") } };
      if (filterName === "created") filter.creator = { id: { eq: entityId(getRecord((await linearFetch(token, "query NstackViewer { viewer { id } }")).viewer), "Viewer") } };
      if (filterName === "completed") filter.state = { type: { eq: "completed" } };
      if (filterName === "open") filter.completedAt = { null: true };
    }
    const variables: Record<string, unknown> = { filter, first, after: args.cursor ?? null };
    const orderBy = args.orderBy === "createdAt" ? "createdAt" : "updatedAt";
    const data = await linearFetch(token, `query NstackIssues($filter: IssueFilter, $first: Int!, $after: String) { issues(filter: $filter, first: $first, after: $after, orderBy: ${orderBy}) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`, variables);
    return pagedResult("issues", isRecord(data.issues) ? data.issues : {}, args.limit ?? null);
  }
  if (operation === "team.list") {
    const data = await linearFetch(token, "query NstackTeams($after: String) { organization { id name url } teams(first: 250, after: $after) { nodes { id key name description } pageInfo { hasNextPage endCursor } } }", { after: args.cursor ?? null });
    const teams = isRecord(data.teams) ? data.teams : {};
    return { workspace: data.organization, ...pagedResult("teams", teams, 250) };
  }
  if (operation === "team.members" || operation === "team.states" || operation === "team.labels") {
    const team = await resolveTeam(token, args.team);
    const id = entityId(team, "Team");
    if (operation === "team.members") {
      const data = await linearFetch(token, "query NstackMembers($id: String!, $after: String) { team(id: $id) { members(first: 250, after: $after) { nodes { id name email } pageInfo { hasNextPage endCursor } } } }", { id, after: args.cursor ?? null });
      const connection = isRecord(data.team) && isRecord(data.team.members) ? data.team.members : {};
      return { team, ...pagedResult("members", connection, 250) };
    }
    if (operation === "team.states") {
      const data = await linearFetch(token, "query NstackStates($teamId: String!, $after: String) { workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 250, after: $after) { nodes { id name type position } pageInfo { hasNextPage endCursor } } }", { teamId: id, after: args.cursor ?? null });
      return pagedResult("states", isRecord(data.workflowStates) ? data.workflowStates : {}, 250);
    }
    const data = await linearFetch(token, "query NstackLabels($teamId: String!, $after: String) { issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 250, after: $after) { nodes { id name color description } pageInfo { hasNextPage endCursor } } }", { teamId: id, after: args.cursor ?? null });
    return pagedResult("labels", isRecord(data.issueLabels) ? data.issueLabels : {}, 250);
  }
  if (operation === "project.list") {
    const queryText = "query NstackProjects($first: Int!, $after: String) { projects(first: $first, after: $after) { nodes { id name description url state startDate targetDate teams { nodes { id key name } } } pageInfo { hasNextPage endCursor } } }";
    const data = await linearFetch(token, queryText, { first, after: args.cursor ?? null });
    let projects = isRecord(data.projects) ? data.projects : {};
    let rows = getNodes(projects);
    if (args.query) rows = rows.filter((row) => String(row.name ?? "").toLowerCase().includes(args.query!.toLowerCase()));
    projects = { ...projects, nodes: rows };
    return pagedResult("projects", projects, args.limit ?? null);
  }
  if (operation === "issue.create" || operation === "issue.save") return createOrUpdateIssue(token, args, operation === "issue.create" || !args.id);
  if (operation === "status.set") {
    const id = await resolveForIssueMutation(token, args);
    const issue = await findIssue(token, id);
    const teamId = isRecord(issue.team) ? entityText(issue.team, "id") : undefined;
    return mutateIssue(token, id, { stateId: entityId(await resolveState(token, args.to!, teamId), "State") });
  }
  if (operation === "assignee.set" || operation === "assignee.clear") {
    const id = await resolveForIssueMutation(token, args);
    return mutateIssue(token, id, { assigneeId: operation === "assignee.clear" ? null : await resolveUser(token, args.to) });
  }
  if (operation === "priority.set" || operation === "priority.clear") {
    const id = await resolveForIssueMutation(token, args);
    return mutateIssue(token, id, { priority: operation === "priority.clear" ? 0 : priorityNumber(args.to!) });
  }
  if (operation === "estimate.set" || operation === "estimate.clear") {
    const id = await resolveForIssueMutation(token, args);
    const estimate = operation === "estimate.clear" ? null : Number(args.to);
    if (estimate !== null && (!Number.isInteger(estimate) || estimate < 0 || estimate > 100)) fail("linear_invalid_arguments", "Estimate must be a non-negative integer.");
    return mutateIssue(token, id, { estimate });
  }
  if (operation === "dueDate.set" || operation === "dueDate.clear") {
    const id = await resolveForIssueMutation(token, args);
    const dueDate = operation === "dueDate.clear" ? null : args.to;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) fail("linear_invalid_arguments", "Due date must use YYYY-MM-DD.");
    return mutateIssue(token, id, { dueDate });
  }
  if (operation.startsWith("label.")) {
    const id = await resolveForIssueMutation(token, args);
    const issue = await findIssue(token, id, "id team { id } labels(first: 100) { nodes { id name } }");
    const teamId = isRecord(issue.team) ? entityText(issue.team, "id") : undefined;
    const existing = getNodes(issue.labels).map((label) => entityText(label, "id")).filter((value): value is string => Boolean(value));
    const requested = await resolveLabelIds(token, args.labels!, teamId);
    const labelIds = operation === "label.set" ? requested : operation === "label.add" ? [...new Set([...existing, ...requested])] : existing.filter((id) => !requested.includes(id));
    return mutateIssue(token, id, { labelIds });
  }
  if (operation === "relation.add" || operation === "relation.remove") {
    const id = await resolveForIssueMutation(token, args);
    const relatedIssueId = await resolveIssueId(token, args.related, "parent");
    if (!relatedIssueId) fail("linear_invalid_parent", "Related issue was not found.");
    const types: Record<string, string> = { blocks: "blocks", "blocked-by": "blockedBy", related: "related", "duplicate-of": "duplicate" };
    const type = types[args.type!];
    if (operation === "relation.add") {
      const data = await linearFetch(token, "mutation NstackRelationCreate($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success issueRelation { id type } } }", { input: { issueId: id, relatedIssueId, type } });
      return data.issueRelationCreate;
    }
    const issue = await findIssue(token, id, "id relations(first: 100) { nodes { id type relatedIssue { id identifier } } }");
    const relation = getNodes(issue.relations).find((row) => entityText(row, "type") === type && isRecord(row.relatedIssue) && row.relatedIssue.id === relatedIssueId);
    if (!relation) return { removed: false };
    const relationId = entityText(relation, "id");
    const data = await linearFetch(token, "mutation NstackRelationDelete($id: String!) { issueRelationDelete(id: $id) { success } }", { id: relationId });
    return data.issueRelationDelete;
  }
  if (operation === "comment.add") {
    const id = await resolveForIssueMutation(token, args);
    const input: Record<string, unknown> = { issueId: id, body: args.body };
    if (args.replyTo) input.parentId = args.replyTo;
    if (args.writeId) input.clientMutationId = args.writeId;
    const data = await linearFetch(token, "mutation NstackCommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body createdAt } } }", { input });
    return data.commentCreate;
  }
  if (operation === "attachment.add") {
    const id = await resolveForIssueMutation(token, args);
    const input: Record<string, unknown> = { issueId: id, url: args.url };
    if (args.title) input.title = args.title;
    if (args.writeId) input.clientMutationId = args.writeId;
    const data = await linearFetch(token, "mutation NstackAttachmentCreate($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success attachment { id title url } } }", { input });
    return data.attachmentCreate;
  }
  fail("linear_invalid_operation", "This Linear operation is not supported.");
}

export const linearRequest = action({
  args: { sessionToken: v.optional(v.string()), apiKey: v.optional(v.string()), operation: v.string(), args: ARGS_VALIDATOR },
  handler: async (ctx, { sessionToken, apiKey, operation, args }) => {
    if (!KNOWN_OPERATIONS[operation]) fail("linear_invalid_operation", "This Linear operation is not supported.");
    validateOperationArgs(operation, args);
    const token = await authorizedToken(ctx, sessionToken, apiKey);
    try {
      return { data: await executeLinearOperation(token, operation, args) };
    } catch (error) {
      const code = error instanceof ConvexError && isRecord(error.data) && typeof error.data.code === "string" ? error.data.code : "";
      if (WRITE_OPERATIONS.has(operation) && code === "linear_network") {
        throw new ConvexError({
          code: "linear_write_unconfirmed",
          message: "Linear may or may not have applied this write. Do not retry with changed fields.",
          ...(args.writeId ? { writeId: args.writeId } : {}),
          nextSteps: args.writeId ? "Retry once with the exact same body and write ID." : "Read the issue back and retry only if the change did not land."
        });
      }
      throw error;
    }
  }
});
