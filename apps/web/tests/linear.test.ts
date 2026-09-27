import { afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../../../convex/_generated/api";
import schema from "../../../convex/schema";
import { convexModules } from "./convexModules";

const ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const CLIENT_HASH = "c".repeat(64);
const POLL_SECRET = "poll-secret-fixture-that-is-long-enough-123456";

async function digest(value: string, encoding: "hex" | "base64url" = "base64url"): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  if (encoding === "hex") return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sessionToken(requestId: string): Promise<string> {
  const raw = Uint8Array.from(atob(ENCRYPTION_KEY), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`nstack-cli-session:${requestId}`)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function configureOAuth(): void {
  vi.stubEnv("LINEAR_TOKEN_ENCRYPTION_KEY", ENCRYPTION_KEY);
  vi.stubEnv("LINEAR_OAUTH_CLIENT_ID", "client-fixture");
  vi.stubEnv("LINEAR_OAUTH_CLIENT_SECRET", "client-secret-fixture");
  vi.stubEnv("LINEAR_OAUTH_REDIRECT_URI", "https://convex.example/linear/oauth/callback");
  vi.stubEnv("LINEAR_CONNECT_URL", "https://web.example");
}
async function expectCode(work: Promise<unknown>, code: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data) {
      expect(error.data.code).toBe(code);
      return;
    }
    expect(String(error)).toContain(code);
    return;
  }
  throw new Error(`Expected ${code} to be thrown`);
}
async function startRequest(state: string) {
  const t = convexTest(schema, convexModules);
  const request = await t.mutation(internal.linear.beginCliAuth, { pollSecretHash: await digest(POLL_SECRET, "hex"), clientHash: CLIENT_HASH });
  await t.mutation(internal.linear.startOAuthInternal, {
    requestId: request.requestId, stateHash: await digest(state), verifier: "server-only-pkce-verifier-fixture"
  });
  return { t, requestId: request.requestId };
}


afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Convex Linear service", () => {
  test("serves the CLI auth and request HTTP contracts", async () => {
    configureOAuth();
    const t = convexTest(schema, convexModules);
    const begin = await t.fetch("/linear/cli/auth/begin", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
      body: JSON.stringify({ pollSecretHash: await digest(POLL_SECRET, "hex") })
    });
    expect(begin.status).toBe(201);
    const request = await begin.json() as { requestId: string; expiresAt: number };
    expect(request.requestId).toBeTruthy();
    expect(request.expiresAt).toBeGreaterThan(Date.now());

    const poll = await t.fetch("/linear/cli/auth/poll", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: request.requestId, pollSecret: POLL_SECRET })
    });
    expect(await poll.json()).toEqual({ status: "pending" });

    const unauthorized = await t.fetch("/linear/cli/request", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "team.list", args: {} })
    });
    const unauthorizedBody = await unauthorized.json();
    expect(unauthorizedBody).toMatchObject({ error: { code: "linear_not_connected" } });
    expect(unauthorized.status).toBe(401);

    const revoked = await t.fetch("/linear/cli/auth/revoke", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionToken: "opaque-session-token-fixture" })
    });
    expect(await revoked.json()).toEqual({ revoked: true });
  });
  test("limits public OAuth starts per client address", async () => {
    configureOAuth();
    const t = convexTest(schema, convexModules);
    const payload = JSON.stringify({ pollSecretHash: await digest(POLL_SECRET, "hex") });
    for (let index = 0; index < 5; index++) {
      const response = await t.fetch("/linear/cli/auth/begin", {
        method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.11" }, body: payload
      });
      expect(response.status).toBe(201);
    }
    const blocked = await t.fetch("/linear/cli/auth/begin", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.11" }, body: payload
    });
    const blockedBody = await blocked.json();
    expect(blockedBody).toMatchObject({ error: { code: "linear_rate_limited" } });
    expect(blocked.status).toBe(429);
    expect(await t.run((ctx) => ctx.db.query("oauthRequests").collect())).toHaveLength(5);
    const limits = await t.run((ctx) => ctx.db.query("oauthStartLimits").collect());
    expect(limits).toHaveLength(1);
    expect(limits[0].clientHash).not.toContain("192.0.2.11");
  });

  test("expires OAuth requests and consumes a completed CLI session only once", async () => {
    configureOAuth();
    const t = convexTest(schema, convexModules);
    const request = await t.mutation(internal.linear.beginCliAuth, { pollSecretHash: await digest(POLL_SECRET, "hex"), clientHash: CLIENT_HASH });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("oauthRequests").withIndex("by_request_id", (q) => q.eq("requestId", request.requestId)).unique();
      if (!row) throw new Error("request was not stored");
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    await expectCode(t.action(api.linear.pollCliAuth, { requestId: request.requestId, pollSecret: POLL_SECRET }), "linear_auth_expired");

    const ready = await t.mutation(internal.linear.beginCliAuth, { pollSecretHash: await digest(POLL_SECRET, "hex"), clientHash: CLIENT_HASH });
    const token = await sessionToken(ready.requestId);
    const tokenHash = await digest(token);
    const expiresAt = Date.now() + 60_000;
    await t.run(async (ctx) => {
      const connectionId = await ctx.db.insert("linearConnections", {
        accountRef: "opaque-account-fixture", encryptedAccessToken: "ciphertext-only", scopes: ["read"],
        accessTokenExpiresAt: Date.now() + 60_000, createdAt: Date.now(), updatedAt: Date.now()
      });
      const row = await ctx.db.query("oauthRequests").withIndex("by_request_id", (q) => q.eq("requestId", ready.requestId)).unique();
      if (!row) throw new Error("request was not stored");
      await ctx.db.insert("cliSessions", { tokenHash, connectionId, expiresAt, createdAt: Date.now() });
      await ctx.db.patch(row._id, { status: "complete", connectionId, sessionExpiresAt: expiresAt });
    });
    const delivered = await t.action(api.linear.pollCliAuth, { requestId: ready.requestId, pollSecret: POLL_SECRET });
    expect(delivered).toEqual({ status: "complete", sessionToken: token, expiresAt });
    expect(await t.action(api.linear.pollCliAuth, { requestId: ready.requestId, pollSecret: POLL_SECRET })).toEqual({ status: "pending" });
  });

  test("starts with PKCE and keeps verifier/state material server-side", async () => {
    configureOAuth();
    const t = convexTest(schema, convexModules);
    const request = await t.mutation(internal.linear.beginCliAuth, { pollSecretHash: await digest(POLL_SECRET, "hex"), clientHash: CLIENT_HASH });
    const started = await t.action(api.linear.startLinearOAuth, { requestId: request.requestId });
    const url = new URL(started.authorizationUrl);
    expect(url.origin).toBe("https://linear.app");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_verifier")).toBeNull();
    const saved = await t.run(async (ctx) => ctx.db.query("oauthRequests").withIndex("by_request_id", (q) => q.eq("requestId", request.requestId)).unique());
    expect(saved?.stateHash).toBe(await digest(url.searchParams.get("state") ?? ""));
    expect(saved?.stateHash).not.toBe(url.searchParams.get("state"));
    expect(saved?.pkceVerifier).toBeTruthy();
    expect(started.authorizationUrl).not.toContain(saved?.pkceVerifier ?? "no-verifier");
  });

  test("keeps Linear tokens encrypted, rejects replayed state, and revokes the opaque CLI credential", async () => {
    configureOAuth();
    const accessToken = "linear-access-token-never-return-this";
    const refreshToken = "linear-refresh-token-never-return-this";
    const state = "oauth-state-fixture";
    const { t, requestId } = await startRequest(state);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.linear.app/oauth/token") return Response.json({ access_token: accessToken, refresh_token: refreshToken, scope: "read,write,issues:create", expires_in: 3600 });
      if (url === "https://api.linear.app/graphql") return Response.json({ data: { viewer: { id: "linear-viewer-fixture" } } });
      throw new Error("unexpected outbound request");
    }));

    const callback = `/linear/oauth/callback?state=${encodeURIComponent(state)}&code=authorization-code-fixture`;
    const response = await t.fetch(callback, { method: "GET" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("result=approved");
    expect(response.headers.get("location")).not.toContain(accessToken);
    const replay = await t.fetch(callback, { method: "GET" });
    expect(replay.headers.get("location")).toContain("result=denied");

    const dbState = await t.run(async (ctx) => ({
      requests: await ctx.db.query("oauthRequests").collect(),
      connections: await ctx.db.query("linearConnections").collect(),
      sessions: await ctx.db.query("cliSessions").collect()
    }));
    expect(dbState.sessions).toHaveLength(1);
    expect(dbState.connections).toHaveLength(1);
    expect(dbState.requests[0].requestId).toBe(requestId);
    expect(JSON.stringify(dbState)).not.toContain(accessToken);
    expect(JSON.stringify(dbState)).not.toContain(refreshToken);

    const poll = await t.action(api.linear.pollCliAuth, { requestId, pollSecret: POLL_SECRET });
    expect(poll.status).toBe("complete");
    if (poll.status !== "complete") throw new Error("session was not delivered");
    expect(poll.sessionToken).not.toBe(accessToken);
    expect(poll.sessionToken).not.toBe(refreshToken);
    expect(JSON.stringify(poll)).not.toContain(accessToken);

    await t.action(api.linear.revokeCliSession, { sessionToken: poll.sessionToken });
    await expectCode(t.action(api.linear.linearRequest, { sessionToken: poll.sessionToken, operation: "team.list", args: {} }), "linear_auth_expired");
  });

  test("denied or failed OAuth never creates a CLI session", async () => {
    configureOAuth();
    const deniedState = "denied-state-fixture";
    const { t: deniedTest, requestId: deniedId } = await startRequest(deniedState);
    const denied = await deniedTest.fetch(`/linear/oauth/callback?error=access_denied&state=${deniedState}`, { method: "GET" });
    expect(denied.headers.get("location")).toContain("result=denied");
    await expectCode(deniedTest.action(api.linear.pollCliAuth, { requestId: deniedId, pollSecret: POLL_SECRET }), "linear_auth_failed");

    const failedState = "failed-state-fixture";
    const { t: failedTest, requestId: failedId } = await startRequest(failedState);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })));
    const failed = await failedTest.fetch(`/linear/oauth/callback?state=${failedState}&code=invalid-code`, { method: "GET" });
    expect(failed.headers.get("location")).toContain("result=denied");
    await expectCode(failedTest.action(api.linear.pollCliAuth, { requestId: failedId, pollSecret: POLL_SECRET }), "linear_auth_failed");
    expect(await failedTest.run((ctx) => ctx.db.query("cliSessions").collect())).toHaveLength(0);
    const expiredState = "expired-state-fixture";
    const { t: expiredTest, requestId: expiredId } = await startRequest(expiredState);
    await expiredTest.run(async (ctx) => {
      const row = await ctx.db.query("oauthRequests").withIndex("by_request_id", (q) => q.eq("requestId", expiredId)).unique();
      if (!row) throw new Error("request was not stored");
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    const expired = await expiredTest.fetch(`/linear/oauth/callback?state=${expiredState}&code=late-code`, { method: "GET" });
    expect(expired.headers.get("location")).toContain("result=denied");
    await expectCode(expiredTest.action(api.linear.pollCliAuth, { requestId: expiredId, pollSecret: POLL_SECRET }), "linear_auth_expired");
  });

  test("constructs only allowlisted operations and uses API keys only for that request", async () => {
    const t = convexTest(schema, convexModules);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { query: string };
      if (request.query.includes("NstackOrganization")) return Response.json({ data: { organization: { id: "workspace-fixture", name: "Fixture workspace", url: "https://linear.app" } } });
      return Response.json({ data: { organization: { id: "workspace-fixture", name: "Fixture workspace", url: "https://linear.app" }, teams: { nodes: [{ id: "team-id", key: "FIX", name: "Fixture team" }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expectCode(t.action(api.linear.linearRequest, { apiKey: "linear-api-key-fixture", operation: "arbitrary.graphql", args: {} }), "linear_invalid_operation");
    expect(fetchMock).not.toHaveBeenCalled();
    await expectCode(
      t.action(api.linear.linearRequest, {
        apiKey: "linear-api-key-fixture", operation: "label.add",
        args: { id: "FIX-1", labels: ["Bug"], workspace: "all" }
      }),
      "linear_invalid_workspace"
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const response = await t.action(api.linear.linearRequest, { apiKey: "linear-api-key-fixture", operation: "team.list", args: {} });
    expect(response.data).toMatchObject({ teams: [{ id: "team-id", key: "FIX" }], meta: { hasMore: false, limit: 250 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const call of fetchMock.mock.calls) expect(new Headers(call[1]?.headers).get("authorization")).toBe("Bearer linear-api-key-fixture");
    expect(JSON.stringify(response)).not.toContain("linear-api-key-fixture");
    expect(await t.run((ctx) => ctx.db.query("cliSessions").collect())).toHaveLength(0);
  });
  test("creates without a team only when the connected workspace has one", async () => {
    const t = convexTest(schema, convexModules);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { query: string };
      if (request.query.includes("NstackTeams")) return Response.json({ data: { teams: { nodes: [{ id: "team-only", key: "ONE", name: "Only team" }] } } });
      if (request.query.includes("NstackIssueCreate")) return Response.json({ data: { issueCreate: { success: true, issue: { id: "created-id", identifier: "ONE-1", title: "Create me" } } } });
      throw new Error(`unexpected GraphQL query: ${request.query}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await t.action(api.linear.linearRequest, {
      apiKey: "linear-api-key-fixture", operation: "issue.create", args: { title: "Create me" }
    });
    expect(response.data.issue.identifier).toBe("ONE-1");
    const createCall = fetchMock.mock.calls.find((call) => JSON.parse(String(call[1]?.body)).query.includes("NstackIssueCreate"));
    expect(JSON.parse(String(createCall?.[1]?.body)).variables.input.teamId).toBe("team-only");

    const multi = convexTest(schema, convexModules);
    const multiFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { query: string };
      return Response.json({ data: { teams: { nodes: [{ id: "one" }, { id: "two" }] } } });
    });
    vi.stubGlobal("fetch", multiFetch);
    await expectCode(multi.action(api.linear.linearRequest, {
      apiKey: "linear-api-key-fixture", operation: "issue.create", args: { title: "Must choose" }
    }), "linear_invalid_team");
    expect(multiFetch).toHaveBeenCalledTimes(1);
  });
  test("search cursors continue pages and issue details expose partial caps and inline media", async () => {
    const t = convexTest(schema, convexModules);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (request.query.includes("NstackSearch")) {
        expect(request.query).toContain("after: $after");
        expect(request.variables.after).toBe("cursor-one");
        return Response.json({ data: { issueSearch: { nodes: [{ id: "i1" }], pageInfo: { hasNextPage: true, endCursor: "cursor-two" } } } });
      }
      if (request.query.includes("NstackOrganization")) return Response.json({ data: { organization: { id: "workspace-fixture", name: "Fixture workspace", url: "https://linear.app" } } });
      return Response.json({ data: { issue: {
        id: "i1", identifier: "FIX-1", description: "![diagram](https://example.com/diagram.png)",
        comments: { nodes: [{ body: "![shot](https://example.com/shot.png)" }], pageInfo: { hasNextPage: true, endCursor: "comments-next" } },
        labels: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
      } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expectCode(t.action(api.linear.linearRequest, {
      apiKey: "linear-api-key-fixture", operation: "issue.search", args: { query: "cursor test", cursor: "cursor-one" }
    }), "linear_invalid_workspace");
    expect(fetchMock).not.toHaveBeenCalled();
    const search = await t.action(api.linear.linearRequest, {
      apiKey: "linear-api-key-fixture", operation: "issue.search",
      args: { query: "cursor test", cursor: "cursor-one", workspace: "workspace-fixture" }
    });
    expect(search.data).toMatchObject({ meta: { hasMore: true, nextCursor: "cursor-two", limit: 20 } });
    const details = await t.action(api.linear.linearRequest, {
      apiKey: "linear-api-key-fixture", operation: "issue.get", args: { id: "FIX-1", comments: true }
    });
    expect(details.data.meta).toEqual({ partial: true, sectionCaps: ["issue.comments"] });
    expect(details.data.inlineMedia).toEqual([
      { source: "issue.description", alt: "diagram", url: "https://example.com/diagram.png" },
      { source: "issue.comments[0].body", alt: "shot", url: "https://example.com/shot.png" }
    ]);
  });
});
