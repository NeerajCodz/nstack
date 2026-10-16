import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const DEFAULT_FIXTURE_COMPONENTS = {
  "agents/security/reviewer.md": "---\nname: reviewer\ndescription: Reviews code for security issues\n---\n",
  "agents/architect.md": "---\nname: architect\ndescription: System architecture planner\n---\n",
  "skills/audit/SKILL.md": "---\nname: audit\ndescription: Web security checklist and audit\n---\n",
  "commands/check.md": "---\nname: check\ndescription: Security tooling runner\n---\n",
  "mcps/context7.json": JSON.stringify({ name: "context7", description: "Documentation search", command: "npx" }, null, 2),
  "plugins/secure-tools/.claude-plugin/plugin.json": JSON.stringify({ name: "secure-tools", description: "Web security workflow" }, null, 2),
  "plugins/secure-tools/skills/SecurityAudit/SKILL.md": "---\nname: SecurityAudit\n---\n",
};

export function createDirectoryFixture(overrides = {}, prefix = "nstack-fixture-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const files = { ...DEFAULT_FIXTURE_COMPONENTS, ...overrides };
  for (const [relativePath, content] of Object.entries(files)) {
    if (content === null || content === undefined) continue;
    const filePath = join(root, ...relativePath.split("/"));
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, cleanup };
}
