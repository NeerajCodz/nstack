import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import test from "node:test";
import { searchAvailable } from "./installer.mjs";

function createSearchFixture() {
  const root = mkdtempSync(join(tmpdir(), "nstack-search-"));
  const files = {
    "agents/zeta.md": "---\nname: Zeta\ndescription: Web security review\n---\n",
    "agents/alpha.md": "---\nname: Alpha\ndescription: WEB SECURITY audit\n---\n",
    "skills/audit/SKILL.md": "---\nname: audit\ndescription: Web security checklist\n---\n",
    "commands/check.md": "---\nname: check\ndescription: Security tooling\n---\n",
    "mcps/context7.json": JSON.stringify({ name: "context7", description: "Documentation search", command: "npx" }),
    "plugins/secure-tools/.claude-plugin/plugin.json": JSON.stringify({ name: "secure-tools", description: "Web workflow" }),
    "plugins/secure-tools/skills/SecurityAudit/SKILL.md": "---\nname: SecurityAudit\n---\n",
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(root, ...relativePath.split("/"));
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }
  return root;
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

test("search matches every case-insensitive token across fields and sorts by type then name", async () => {
  const directoryRoot = createSearchFixture();
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
    rmSync(directoryRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("search indexes nested plugin resource names", async () => {
  const directoryRoot = createSearchFixture();
  const cwd = mkdtempSync(join(tmpdir(), "nstack-search-cwd-"));
  try {
    const { result } = await captureOutput(() => searchAvailable(cwd, "securityaudit", directoryRoot));
    assert.deepEqual(result.map(({ componentType, name }) => `${componentType}/${name}`), ["plugin/secure-tools"]);
  } finally {
    rmSync(directoryRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("search prints a successful no-match result and rejects blank queries", async () => {
  const directoryRoot = createSearchFixture();
  const cwd = mkdtempSync(join(tmpdir(), "nstack-search-cwd-"));
  try {
    const { result, output } = await captureOutput(() => searchAvailable(cwd, "does not exist", directoryRoot));
    assert.deepEqual(result, []);
    assert.equal(output, 'No components match "does not exist".');
    await assert.rejects(searchAvailable(cwd, "  \t ", directoryRoot), { message: "Usage: nstack search <query>" });
  } finally {
    rmSync(directoryRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
