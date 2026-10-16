import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import test from "node:test";
import { searchAvailable } from "./installer.mjs";
import { createDirectoryFixture } from "./directory-fixture.mjs";

const searchFixtureOverrides = {
  "agents/zeta.md": "---\nname: Zeta\ndescription: Web security review\n---\n",
  "agents/alpha.md": "---\nname: Alpha\ndescription: WEB SECURITY audit\n---\n",
};

async function captureOutput(action) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...values) => lines.push(values.join(" "));
  try {
    const result = await action();
    return { result, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
  }
}

test("search matches every case-insensitive token across fields and sorts by type then name", async () => {
  const { root: directoryRoot, cleanup } = createDirectoryFixture(searchFixtureOverrides, "nstack-search-");
  const cwd = mkdtempSync(join(tmpdir(), "nstack-search-cwd-"));
  try {
    const { result, output } = await captureOutput(() => searchAvailable(cwd, "WEB security", directoryRoot));
    assert.deepEqual(result.map(({ componentType, name }) => `${componentType}/${name}`), [
      "agent/Alpha", "agent/Zeta", "plugin/secure-tools", "skill/audit",
    ]);
    assert.match(output, /agent\/Alpha — WEB SECURITY audit/);
    assert.match(output, /plugin\/secure-tools/);
    assert.match(output, /nstack install plugin\/secure-tools/);
    assert.doesNotMatch(output, /command\/check|mcp\/context7/);
  } finally {
    cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("search indexes nested plugin resource names", async () => {
  const { root: directoryRoot, cleanup } = createDirectoryFixture(searchFixtureOverrides, "nstack-search-");
  const cwd = mkdtempSync(join(tmpdir(), "nstack-search-cwd-"));
  try {
    const { result } = await captureOutput(() => searchAvailable(cwd, "securityaudit", directoryRoot));
    assert.deepEqual(result.map(({ componentType, name }) => `${componentType}/${name}`), ["plugin/secure-tools"]);
  } finally {
    cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("search prints a successful no-match result and rejects blank queries", async () => {
  const { root: directoryRoot, cleanup } = createDirectoryFixture(searchFixtureOverrides, "nstack-search-");
  const cwd = mkdtempSync(join(tmpdir(), "nstack-search-cwd-"));
  try {
    const { result, output } = await captureOutput(() => searchAvailable(cwd, "does not exist", directoryRoot));
    assert.deepEqual(result, []);
    assert.equal(output, 'No components match "does not exist".');
    await assert.rejects(searchAvailable(cwd, "  \t ", directoryRoot), { message: "Usage: nstack search <query>" });
  } finally {
    cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("search relevance ranking prioritizes exact name match over description match", async () => {
  const { root: directoryRoot, cleanup } = createDirectoryFixture(searchFixtureOverrides, "nstack-search-");
  const cwd = mkdtempSync(join(tmpdir(), "nstack-search-cwd-"));
  try {
    const { result } = await captureOutput(() => searchAvailable(cwd, "audit", directoryRoot));
    const names = result.map(({ componentType, name }) => `${componentType}/${name}`);
    // skill/audit is Tier 1 (exact name match)
    // agent/Alpha is Tier 4 (matches 'audit' in description)
    // plugin/secure-tools is Tier 4 (matches 'SecurityAudit' in nested skill)
    assert.equal(names[0], "skill/audit");
    assert.ok(names.indexOf("skill/audit") < names.indexOf("agent/Alpha"));
  } finally {
    cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("search with --json outputs valid JSON array with installCommand and handles no-match", async () => {
  const { root: directoryRoot, cleanup } = createDirectoryFixture(searchFixtureOverrides, "nstack-search-");
  const cwd = mkdtempSync(join(tmpdir(), "nstack-search-cwd-"));
  try {
    const { result, output } = await captureOutput(() =>
      searchAvailable(cwd, "audit", directoryRoot, { json: true })
    );
    const parsed = JSON.parse(output);
    assert.deepEqual(result, parsed);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length > 0);
    assert.equal(parsed[0].componentType, "skill");
    assert.equal(parsed[0].name, "audit");
    assert.equal(parsed[0].installCommand, "nstack install skill/audit");
    assert.ok("source" in parsed[0]);
    assert.ok("description" in parsed[0]);

    const { result: noMatchResult, output: noMatchOutput } = await captureOutput(() =>
      searchAvailable(cwd, "does not exist", directoryRoot, { json: true })
    );
    assert.deepEqual(noMatchResult, []);
    assert.equal(noMatchOutput.trim(), "[]");
    assert.deepEqual(JSON.parse(noMatchOutput), []);
  } finally {
    cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});
