import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import test from "node:test";
import assert from "node:assert/strict";
import { showStatus } from "./status.mjs";
import { writeConfig } from "./config.mjs";

async function withTempDir(run) {
  const root = mkdtempSync(join(tmpdir(), "nstack-status-test-"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

test("uninitialized directory outputs friendly message in text mode", async () => {
  await withTempDir(async (cwd) => {
    const { result, output } = await captureOutput(() => showStatus(cwd, { json: false }));
    assert.equal(result, undefined);
    assert.match(output, /nstack status/);
    assert.match(output, /Not initialized\. Run 'nstack init' first\./);
  });
});

test("uninitialized directory outputs initialized: false in json mode", async () => {
  await withTempDir(async (cwd) => {
    const { result, output } = await captureOutput(() => showStatus(cwd, { json: true }));
    assert.deepEqual(result, { initialized: false });
    const parsed = JSON.parse(output);
    assert.deepEqual(parsed, { initialized: false });
  });
});

test("initialized directory outputs tools, installed counts, and .nstack contents in text mode", async () => {
  await withTempDir(async (cwd) => {
    const config = {
      version: "1.0.0",
      initialized: "2026-10-16T00:00:00.000Z",
      projectHome: true,
      tools: {
        codex: {
          description: "Codex CLI",
          configDir: ".nstack/codex",
          envVar: "CODEX_HOME",
        },
      },
      installed: {
        agents: [{ name: "reviewer" }],
        skills: [{ name: "audit" }],
        plugins: [],
        hooks: [],
        commands: [],
        mcps: [],
      },
    };
    writeConfig(cwd, config);

    const codexDir = join(cwd, ".nstack", "codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, "config.toml"), "dummy = true\n");

    const { output } = await captureOutput(() => showStatus(cwd, { json: false }));

    assert.match(output, /Version: 1\.0\.0/);
    assert.match(output, /Mode: project-home/);
    assert.match(output, /Tools \(1\):/);
    assert.match(output, /codex: Codex CLI/);
    assert.match(output, /Agents:\s+1/);
    assert.match(output, /Skills:\s+1/);
    assert.match(output, /Plugins:\s+0/);
    assert.match(output, /\.nstack\/ contents:/);
    assert.match(output, /codex\/ \(1 items\)/);
    assert.match(output, /config\.json/);
  });
});

test("initialized directory outputs full structured json", async () => {
  await withTempDir(async (cwd) => {
    const config = {
      version: "1.0.0",
      initialized: "2026-10-16T00:00:00.000Z",
      projectHome: false,
      tools: {
        claude: {
          description: "Claude Code",
        },
      },
      installed: {
        agents: [{ name: "architect" }],
        skills: [],
        plugins: [],
        hooks: [],
        commands: [],
        mcps: [],
      },
    };
    writeConfig(cwd, config);

    const testSubdir = join(cwd, ".nstack", "custom-dir");
    mkdirSync(testSubdir, { recursive: true });
    writeFileSync(join(testSubdir, "sub.txt"), "hello");

    const { result, output } = await captureOutput(() => showStatus(cwd, { json: true }));
    const parsed = JSON.parse(output);

    assert.deepEqual(result, parsed);
    assert.equal(parsed.initialized, true);
    assert.equal(parsed.version, "1.0.0");
    assert.equal(parsed.mode, "default-home");
    assert.deepEqual(parsed.tools, config.tools);
    assert.deepEqual(parsed.installed, config.installed);

    const contentsByName = Object.fromEntries(parsed.nstackContents.map((entry) => [entry.name, entry]));
    assert.ok(contentsByName["config.json"]);
    assert.equal(contentsByName["config.json"].type, "file");
    assert.ok(contentsByName["custom-dir"]);
    assert.equal(contentsByName["custom-dir"].type, "directory");
    assert.equal(contentsByName["custom-dir"].count, 1);
  });
});
