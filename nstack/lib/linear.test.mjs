import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix as posixPath, win32 as win32Path } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { LinearError, formatLinearError, linear, linearCredentialPath } from "./linear.mjs";

const CONVEX_URL = "https://convex.example";
const API_ENV = { NSTACK_LINEAR_CONVEX_URL: CONVEX_URL, LINEAR_API_KEY: "fixture-key" };
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function ok(data) { return { data }; }

async function expectLinearError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("Linear help documents concrete-workspace cursor handling", async () => {
  const result = await linear(["--help"]);
  assert.match(result.data, /--cursor <cursor> --workspace <id>/);
  assert.match(result.data, /All Linear API calls pass through the configured Convex service/);
});
test("search uses only the Convex request route, applies API-key precedence, and preserves pagination metadata", async () => {
  const requests = [];
  const result = await linear(["search", "login", "bug", "--limit", "90", "--workspace", "all", "--json"], {
    env: API_ENV,
    transport: async (request) => {
      requests.push(request);
      return ok({ issues: [{ identifier: "APP-7", title: "Login" }], truncated: true, meta: { hasMore: true, nextCursor: "next-page" } });
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, `${CONVEX_URL}/linear/cli/request`);
  assert.equal(requests[0].body.operation, "issue.search");
  assert.deepEqual(requests[0].body.args, { query: "login bug", limit: 50, workspace: "all" });
  assert.equal(requests[0].body.apiKey, "fixture-key");
  assert.equal("sessionToken" in requests[0].body, false);
  assert.deepEqual(result.data.meta, { hasMore: true, nextCursor: "next-page", limit: 50 });
  assert.equal(result.data.truncated, true);
});
test("search continuation requires and forwards its concrete workspace cursor", async () => {
  await expectLinearError(linear(["search", "login", "--cursor", "cursor-one"], {
    env: API_ENV, transport: async () => assert.fail("must reject an unbound cursor"),
  }), "linear_invalid_workspace");
  let sent;
  await linear(["search", "login", "--cursor", "cursor-one", "--workspace", "workspace-id", "--json"], {
    env: API_ENV,
    transport: async (request) => { sent = request; return ok({ issues: [], meta: { hasMore: false } }); },
  });
  assert.equal(sent.body.operation, "issue.search");
  assert.deepEqual(sent.body.args, { query: "login", limit: 20, cursor: "cursor-one", workspace: "workspace-id" });
});

test("issue full context normalizes depth and workspace-all lookups fail before transport", async () => {
  let sent;
  const result = await linear(["issue", "APP-7", "--full", "--depth", "99", "--json"], {
    env: API_ENV,
    transport: async (request) => { sent = request; return ok({ issue: { id: "issue-id", identifier: "APP-7" }, inlineMedia: [], meta: { partial: true } }); },
  });
  assert.equal(sent.body.operation, "issue.get");
  assert.equal(sent.body.args.depth, 5);
  for (const section of ["comments", "children", "attachments", "relations", "activity", "full"]) assert.equal(sent.body.args[section], true);
  assert.equal(result.data.issue.identifier, "APP-7");
  await expectLinearError(linear(["issue", "APP-7", "--workspace", "all"], { env: API_ENV, transport: async () => assert.fail("must not call backend") }), "linear_invalid_workspace");
});

test("list-issues rejects an unbound workspace cursor and preserves server truncation/cursor metadata", async () => {
  await expectLinearError(linear(["list-issues", "--cursor", "opaque"], { env: API_ENV, transport: async () => assert.fail("must not call backend") }), "linear_invalid_workspace");
  let sent;
  const result = await linear(["list-issues", "--team", "APP", "--priority", "1", "--assignee", "me", "--cursor", "opaque", "--workspace", "workspace-id", "--json"], {
    env: API_ENV,
    transport: async (request) => { sent = request; return ok({ issues: [{ identifier: "APP-9", priorityLabel: "urgent" }], truncated: true, meta: { hasMore: true, nextCursor: "opaque-next" } }); },
  });
  assert.equal(sent.body.operation, "issue.listIssues");
  assert.equal(sent.body.args.priority, 1);
  assert.equal(sent.body.args.assignee, "me");
  assert.deepEqual(result.data.meta, { hasMore: true, nextCursor: "opaque-next", limit: null });
});

test("save-issue treats labels as full replacement and literal null clears project", async () => {
  const requests = [];
  await linear(["save-issue", "APP-7", "--project", "null", "--due-date", "null", "--label", "Fixture", "--label", "Urgent", "--json"], {
    env: API_ENV,
    transport: async (request) => {
      requests.push(request);
      return request.body.operation === "issue.get" ? ok({ issue: { id: "issue-id", state: { type: "started" } } }) : ok({ issue: { identifier: "APP-7", project: null } });
    },
  });
  const mutation = requests.at(-1).body;
  assert.equal(mutation.operation, "issue.save");
  assert.equal(mutation.args.project, null);
  assert.equal(mutation.args.dueDate, null);
  assert.deepEqual(mutation.args.labels, ["Fixture", "Urgent"]);
  assert.equal(requests[0].body.operation, "issue.get");
});

test("create returns the created issue with explicit team and title", async () => {
  const calls = [];
  const result = await linear(["create", "--title", "Add fixture", "--team", "TEAM", "--priority", "urgent", "--json"], {
    env: API_ENV,
    transport: async ({ body }) => {
      calls.push(body);
      return ok({ issue: { identifier: "APP-41", title: "Add fixture", priorityLabel: "urgent" } });
    },
  });
  const created = calls[0];
  assert.equal(created.operation, "issue.create");
  assert.equal(created.args.team, "TEAM");
  assert.equal(created.args.title, "Add fixture");
  assert.deepEqual(result.data.issue, { identifier: "APP-41", title: "Add fixture", priorityLabel: "urgent" });
});
test("field updates use the service's shared to-selector contract", async () => {
  const calls = [];
  for (const [command, expected] of [
    [["assignee", "set", "APP-7", "--me"], ["assignee.set", "me"]],
    [["priority", "set", "APP-7", "--to", "urgent"], ["priority.set", "urgent"]],
    [["estimate", "set", "APP-7", "--to", "3"], ["estimate.set", "3"]],
  ]) {
    await linear([...command, "--json"], {
      env: API_ENV,
      transport: async ({ body }) => { calls.push(body); return ok({ issue: { identifier: "APP-7" } }); },
    });
    assert.equal(calls.at(-1).operation, expected[0]);
    assert.equal(calls.at(-1).args.to, expected[1]);
  }
});

test("label add/remove are incremental and relation writes return updated relationship data", async () => {
  const issue = {
    id: "issue-id", identifier: "APP-7", state: { type: "started" },
    labels: [{ id: "existing-id", name: "Existing" }], relations: [],
  };
  const results = [];
  const transport = async ({ body }) => {
    if (body.operation === "issue.get") return ok({ issue: structuredClone(issue) });
    if (body.operation === "label.add") issue.labels.push(...body.args.labels.map((name, index) => ({ id: `new-${index}`, name })));
    if (body.operation === "label.remove") issue.labels = issue.labels.filter((label) => !body.args.labels.includes(label.name));
    if (body.operation === "relation.add") issue.relations.push({ related: body.args.related, type: body.args.type });
    if (body.operation === "relation.remove") issue.relations = issue.relations.filter((relation) => relation.related !== body.args.related);
    results.push({ operation: body.operation, args: body.args });
    return ok({ issue: structuredClone(issue) });
  };

  const added = await linear(["label", "add", "APP-7", "--label", "New", "--json"], { env: API_ENV, transport });
  const removed = await linear(["label", "remove", "APP-7", "--label", "Existing", "--json"], { env: API_ENV, transport });
  const related = await linear(["relation", "add", "APP-7", "--related", "APP-8", "--type", "blocks", "--json"], { env: API_ENV, transport });

  assert.deepEqual(added.data.issue.labels.map((label) => label.name), ["Existing", "New"]);
  assert.deepEqual(removed.data.issue.labels.map((label) => label.name), ["New"]);
  assert.deepEqual(related.data.issue.relations, [{ related: "APP-8", type: "blocks" }]);
  assert.ok(results.some(({ operation, args }) => operation === "relation.add" && args.type === "blocks" && args.related === "APP-8"));
});

test("comment body-file reads the supplied content and completed issues reject status mutations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nstack-linear-body-"));
  try {
    const bodyPath = join(dir, "comment.txt");
    writeFileSync(bodyPath, `Ready for review.
See the linked pull request.`);
    let comment;
    const commentResult = await linear(["comment", "add", "APP-7", "--body-file", bodyPath, "--json"], {
      env: API_ENV,
      transport: async ({ body }) => {
        if (body.operation === "issue.get") return ok({ issue: { id: "issue-id", state: { type: "started" } } });
        comment = body.args.body;
        return ok({ comment: { body: comment } });
      },
    });
    assert.equal(comment, `Ready for review.
See the linked pull request.`);
    assert.deepEqual(commentResult.data.comment, { body: comment });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const calls = [];
  await expectLinearError(linear(["status", "set", "APP-7", "--to", "In Review"], {
    env: API_ENV,
    transport: async ({ body }) => {
      calls.push(body.operation);
      return body.operation === "issue.get"
        ? ok({ issue: { id: "issue-id", state: { name: "Done", type: "completed" } } })
        : ok({});
    },
  }), "linear_invalid_state");
  assert.deepEqual(calls, ["issue.get"]);
});

test("write-id uncertainty replays precisely once with the same mutation payload", async () => {
  const mutationRequests = [];
  let failedOnce = false;
  const result = await linear(["comment", "add", "APP-7", "--body", "Review ready", "--write-id", WRITE_ID, "--json"], {
    env: API_ENV,
    transport: async (request) => {
      if (request.body.operation === "issue.get") return ok({ issue: { id: "issue-id", state: { type: "started" } } });
      mutationRequests.push(request.body);
      if (!failedOnce) {
        failedOnce = true;
        return { error: { code: "linear_write_unconfirmed", message: "write response lost", data: { writeId: WRITE_ID } } };
      }
      return ok({ issue: { identifier: "APP-7", labels: [{ name: "Bug" }] } });
    },
  });
  assert.equal(mutationRequests.length, 2);
  assert.deepEqual(mutationRequests[0], mutationRequests[1]);
  assert.equal(result.data.issue.identifier, "APP-7");
});
test("uncertain numeric field writes stop after read-back observes the requested value", async () => {
  for (const [command, field, applied] of [
    [["priority", "set", "APP-7", "--to", "urgent"], "priority", 1],
    [["estimate", "set", "APP-7", "--to", "3"], "estimate", 3],
  ]) {
    let reads = 0;
    let writes = 0;
    await linear([...command, "--json"], {
      env: API_ENV,
      transport: async ({ body }) => {
        if (body.operation === "issue.get") {
          reads += 1;
          return ok({ issue: { id: "issue-id", state: { type: "started" }, [field]: reads === 1 ? 0 : applied } });
        }
        writes += 1;
        return { error: { code: "linear_write_unconfirmed", message: "write response lost" } };
      },
    });
    assert.equal(reads, 2);
    assert.equal(writes, 1);
  }
});

test("unconfirmed writes without a matching write id read back before one safe retry", async () => {
  const requests = [];
  let reads = 0;
  let writes = 0;
  const result = await linear(["attach", "APP-7", "--url", "https://example.com/pr/1", "--json"], {
    env: API_ENV,
    transport: async (request) => {
      requests.push(request.body.operation);
      if (request.body.operation === "issue.get") {
        reads += 1;
        return ok({ issue: { id: "issue-id", state: { type: "started" }, attachments: [] } });
      }
      writes += 1;
      if (writes === 1) return { error: { code: "linear_write_unconfirmed", message: "response lost" } };
      return ok({ issue: { identifier: "APP-7", attachments: [{ url: "https://example.com/pr/1" }] } });
    },
  });
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.deepEqual(requests, ["issue.get", "attachment.add", "issue.get", "attachment.add"]);
  assert.equal(result.data.issue.identifier, "APP-7");
});

test("backend selector and permission errors retain stable Linear codes", async () => {
  for (const [raw, normalized] of [["invalid_state", "linear_invalid_state"], ["invalid_assignee", "linear_invalid_assignee"], ["permission_denied", "linear_permission_denied"]]) {
    await expectLinearError(linear(["team", "states", "--team", "APP"], {
      env: API_ENV,
      transport: async () => ({ error: { code: raw, message: "selector is ambiguous", data: { matches: 2 } } }),
    }), normalized);
  }
  assert.deepEqual(formatLinearError(new LinearError("invalid_project", "ambiguous")), { code: "linear_invalid_project", message: "ambiguous" });
});

test("attachment and body validation reject invalid inputs before mutation", async () => {
  let calls = 0;
  const options = { env: API_ENV, transport: async () => { calls += 1; return ok({}); } };
  await expectLinearError(linear(["attach", "APP-1", "--url", "javascript:alert(1)"], options), "linear_invalid_argument");
  await expectLinearError(linear(["due-date", "set", "APP-1", "--to", "2025-02-30"], options), "linear_invalid_argument");
  await expectLinearError(linear(["comment", "add", "APP-1", "--body", "a", "--body-file", "missing.txt"], options), "linear_invalid_argument");
  assert.equal(calls, 0);
});

test("current issue uses Orca only when explicitly requested and requires reachable runtime", async () => {
  const commands = [];
  const result = await linear(["issue", "--current", "--json"], {
    env: {},
    lookupExecutable: () => true,
    runner: (_command, args) => {
      commands.push(args);
      if (args[0] === "status") return JSON.stringify({ desktop: { reachable: true } });
      return JSON.stringify({ issue: { id: "issue-id", identifier: "APP-22", description: "Untrusted ticket text" } });
    },
  });
  assert.deepEqual(commands, [["status", "--json"], ["linear", "issue", "--current", "--full", "--json"]]);
  assert.equal(result.data.issue.identifier, "APP-22");
  await expectLinearError(linear(["issue", "--current"], { env: {}, lookupExecutable: () => true, runner: () => JSON.stringify({ status: "offline" }) }), "linear_issue_required");
});

test("OAuth login hashes a process-only poll secret and stores only the opaque session token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nstack-linear-auth-"));
  try {
    const credentialPath = join(dir, "nstack", "linear.json");
    const requests = [];
    const opened = [];
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    const result = await linear(["auth", "login", "--json"], {
      env: { NSTACK_LINEAR_CONVEX_URL: CONVEX_URL, NSTACK_LINEAR_WEB_URL: "https://web.example" },
      platform: process.platform, credentialPath, now: () => now,
      openBrowser: async (url) => opened.push(url), sleep: async () => {},
      transport: async (request) => {
        requests.push(request);
        if (request.route.endsWith("/auth/begin")) return { requestId: "request-1", expiresAt: "2026-09-01T00:05:00.000Z" };
        if (request.route.endsWith("/auth/poll")) return { status: "complete", sessionToken: "opaque-session", expiresAt: "2026-10-01T00:00:00.000Z" };
        if (request.route.endsWith("/auth/revoke")) return { revoked: true };
        throw new Error(`Unexpected route: ${request.route}`);
      },
    });
    assert.deepEqual(result.data, { status: "connected", expiresAt: "2026-10-01T00:00:00.000Z" });
    assert.equal(opened[0], "https://web.example/linear/connect?requestId=request-1");
    const begin = requests[0].body;
    const poll = requests[1].body;
    assert.match(begin.pollSecretHash, /^[a-f0-9]{64}$/);
    assert.notEqual(begin.pollSecretHash, poll.pollSecret);
    assert.equal(createHash("sha256").update(poll.pollSecret).digest("hex"), begin.pollSecretHash);
    assert.deepEqual(JSON.parse(readFileSync(credentialPath, "utf8")), { sessionToken: "opaque-session", expiresAt: "2026-10-01T00:00:00.000Z" });
    assert.equal((await linear(["auth", "status"], { env: {}, credentialPath, now: () => now })).data.status, "connected");
    const logout = await linear(["auth", "logout"], { env: { NSTACK_LINEAR_CONVEX_URL: CONVEX_URL }, credentialPath, transport: async (request) => { requests.push(request); return { revoked: true }; } });
    assert.deepEqual(logout.data, { revoked: true });
    assert.equal(requests.at(-1).route, "/linear/cli/auth/revoke");
    assert.equal(requests.at(-1).body.sessionToken, "opaque-session");
    assert.equal(existsSync(credentialPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("credential paths follow platform user-config conventions", () => {
  assert.equal(linearCredentialPath({ platform: "win32", env: { APPDATA: "C:\\Users\\fixture\\AppData\\Roaming" } }), win32Path.join("C:\\Users\\fixture\\AppData\\Roaming", "nstack", "linear.json"));
  assert.equal(linearCredentialPath({ platform: "linux", env: { XDG_CONFIG_HOME: "/tmp/config" } }), posixPath.join("/tmp/config", "nstack", "linear.json"));
});

test("LINEAR_API_KEY overrides a saved OAuth session for requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nstack-linear-precedence-"));
  try {
    const credentialPath = join(dir, "linear.json");
    writeFileSync(credentialPath, JSON.stringify({ sessionToken: "saved-session", expiresAt: "2099-01-01T00:00:00.000Z" }));
    let sent;
    const result = await linear(["team", "list", "--json"], {
      env: API_ENV, credentialPath,
      transport: async (request) => { sent = request.body; return ok({ teams: [{ id: "team-fixture" }] }); },
    });
    assert.equal(sent.apiKey, "fixture-key");
    assert.equal("sessionToken" in sent, false);
    assert.deepEqual(result.data.teams, [{ id: "team-fixture" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
