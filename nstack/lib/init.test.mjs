import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import test from "node:test";
import assert from "node:assert/strict";
import { initProject } from "./init.mjs";
import { CodexAdapter } from "./adapters/codex.mjs";
import { AgyAdapter } from "./adapters/agy.mjs";

const directoryRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "directory");
const template = readFileSync(join(directoryRoot, "templates", "nstack", "AGENTS.md"), "utf8");

function projectDir(root, name) {
  const cwd = join(root, name);
  mkdirSync(cwd);
  return cwd;
}

async function withTempDir(run) {
  const root = mkdtempSync(join(tmpdir(), "nstack-init-"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("bare project init installs the default AGENTS guidance", async () => {
  await withTempDir(async (root) => {
    const cwd = projectDir(root, "bare");
    await initProject(cwd, directoryRoot, false);
    assert.equal(readFileSync(join(cwd, "AGENTS.md"), "utf8"), template);
  });
});

test("bare project init preserves an existing AGENTS file byte-for-byte", async () => {
  await withTempDir(async (root) => {
    const cwd = projectDir(root, "custom");
    const original = Buffer.from("# Custom rules\r\n\0\n", "utf8");
    writeFileSync(join(cwd, "AGENTS.md"), original);
    await initProject(cwd, directoryRoot, false);
    assert.deepEqual(readFileSync(join(cwd, "AGENTS.md")), original);
  });
});

for (const [name, Adapter] of [["Codex", CodexAdapter], ["Antigravity", AgyAdapter]]) {
  test(`${name} init uses shared guidance only when AGENTS is absent`, async () => {
    await withTempDir(async (root) => {
      const adapter = new Adapter();
      const created = projectDir(root, "created");
      await adapter.init(created, true, directoryRoot);
      assert.equal(readFileSync(join(created, "AGENTS.md"), "utf8"), template);

      const existing = projectDir(root, "existing");
      const original = Buffer.from("user-owned rules\r\n", "utf8");
      writeFileSync(join(existing, "AGENTS.md"), original);
      await adapter.init(existing, true, directoryRoot);
      assert.deepEqual(readFileSync(join(existing, "AGENTS.md")), original);
    });
  });
}
