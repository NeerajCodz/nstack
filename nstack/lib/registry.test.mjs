import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import test from "node:test";
import { buildRegistry } from "./registry.mjs";

test("registry scans category roots and keeps sources relative to the directory checkout", () => {
  const directoryRoot = mkdtempSync(join(tmpdir(), "nstack-registry-"));
  try {
    const files = {
      "agents/security/reviewer.md": "---\nname: reviewer\ndescription: Reviews code\n---\n",
      "skills/audit/SKILL.md": "---\nname: audit\n---\n",
      "commands/check.md": "---\nname: check\n---\n",
      "mcps/search.json": JSON.stringify({ name: "search", command: "npx" }),
      "plugins/example/agents/architect.md": "---\nname: architect\n---\n",
      "plugins/example/.claude-plugin/plugin.json": JSON.stringify({ name: "example", description: "Example plugin" }),
    };
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = join(directoryRoot, ...relativePath.split("/"));
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, content);
    }

    const registry = buildRegistry(directoryRoot);
    assert.equal(registry.agents.find((item) => item.name === "reviewer").source, "agents/security/reviewer.md");
    assert.equal(registry.skills.find((item) => item.name === "audit").source, "skills/audit");
    assert.equal(registry.commands.find((item) => item.name === "check").source, "commands/check.md");
    assert.equal(registry.mcps.find((item) => item.name === "search").source, "mcps/search.json");
    assert.equal(registry.plugins.find((item) => item.name === "example").source, "plugins/example");
  } finally {
    rmSync(directoryRoot, { recursive: true, force: true });
  }
});
