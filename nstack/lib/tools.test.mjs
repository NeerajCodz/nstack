import test from "node:test";
import assert from "node:assert/strict";
import { ensureGh, detectOrca } from "./tools.mjs";

function responses(version, auth = true) {
  const calls = [];
  return { calls, runner(command, args) {
    calls.push([command, [...args]]);
    if (command === "gh" && args[0] === "--version") {
      if (!version.value) throw new Error("not installed");
      return `gh version ${version.value} (2026-01-01)`;
    }
    if (command === "gh" && args[0] === "auth" && !auth) throw new Error("not logged in");
    if (args[0] === "install" || args[0] === "upgrade") version.value = "2.99.0";
    return "ok";
  } };
}
const fetchRelease = async () => ({ ok: true, json: async () => ({ tag_name: "v2.99.0" }) });

test("current gh is not reinstalled and missing auth remains noninteractive", async () => {
  const state = { value: "2.99.0" };
  const mock = responses(state, false);
  const messages = [];
  const result = await ensureGh({ platform: "win32", runner: mock.runner, fetchImpl: fetchRelease, log: (message) => messages.push(message) });
  assert.equal(result.authenticated, false);
  assert.equal(mock.calls.some(([, args]) => ["install", "upgrade"].includes(args[0])), false);
  assert.ok(messages.some((message) => message.includes("gh auth login")));
});

test("missing gh uses the official package manager; installed gh is never replaced", async () => {
  const missing = { value: null };
  const missingMock = responses(missing);
  await ensureGh({ platform: "win32", runner: missingMock.runner, fetchImpl: fetchRelease, log() {} });
  assert.ok(missingMock.calls.some(([command]) => command === "winget"));
  assert.equal(missing.value, "2.99.0");

  const old = { value: "2.0.0" };
  const staleMock = responses(old);
  const result = await ensureGh({ platform: "darwin", runner: staleMock.runner, fetchImpl: fetchRelease, log() {} });
  assert.equal(result.installedVersion, "2.0.0");
  assert.equal(staleMock.calls.some(([command]) => command === "brew"), false);
});

test("unsupported platforms and non-current post-install versions fail clearly", async () => {
  const noCalls = { runner() { throw new Error("not found"); } };
  await assert.rejects(ensureGh({ platform: "plan9", runner: noCalls.runner, fetchImpl: fetchRelease, log() {} }), /Cannot install GitHub CLI/);
  const state = { value: null };
  const mock = responses(state);
  mock.runner = (command, args) => {
    if (command === "gh" && args[0] === "--version") throw new Error("absent");
    if (command === "winget") return "installed";
    return "";
  };
  await assert.rejects(ensureGh({ platform: "win32", runner: mock.runner, fetchImpl: fetchRelease, log() {} }), /still unavailable after installation/);
});

test("Orca detection requires a reachable JSON desktop runtime", async () => {
  assert.equal(await detectOrca({ runner: () => JSON.stringify({ status: "connected" }) }), true);
  assert.equal(await detectOrca({ runner: () => JSON.stringify({ status: "disconnected" }) }), false);
  assert.equal(await detectOrca({ runner: () => { throw new Error("missing"); } }), false);
});
