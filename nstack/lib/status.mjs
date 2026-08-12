import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { readConfig } from "./config.mjs";

export async function showStatus(cwd) {
  const config = readConfig(cwd);
  console.log("nstack status");
  console.log("=".repeat(50));

  if (!config) {
    console.log("\nNot initialized. Run 'nstack init' first.");
    return;
  }

  console.log(`\nVersion: ${config.version}`);
  console.log(`Initialized: ${config.initialized}`);
  console.log(`Mode: ${config.projectHome ? "project-home (.nstack/<tool>/)" : "default-home (~/.<tool>/)"}`);

  const tools = Object.keys(config.tools || {});
  console.log(`\nTools (${tools.length}):`);
  for (const tool of tools) {
    const t = config.tools[tool];
    console.log(`  - ${tool}: ${t.description || tool}`);
    if (t.configDir) console.log(`    dir: ${t.configDir}`);
    if (t.envVar) console.log(`    env: ${t.envVar}`);
  }
  if (tools.length === 0) console.log("  (none initialized)");

  const installed = config.installed || {};
  console.log("\nInstalled:");
  console.log(`  Agents:    ${(installed.agents || []).length}`);
  console.log(`  Skills:    ${(installed.skills || []).length}`);
  console.log(`  Plugins:   ${(installed.plugins || []).length}`);
  console.log(`  Hooks:     ${(installed.hooks || []).length}`);
  console.log(`  Commands:  ${(installed.commands || []).length}`);
  console.log(`  MCPs:      ${(installed.mcps || []).length}`);

  const nstackDir = join(cwd, ".nstack");
  if (existsSync(nstackDir)) {
    console.log("\n.nstack/ contents:");
    for (const entry of readdirSync(nstackDir)) {
      const fullPath = join(nstackDir, entry);
      if (statSync(fullPath).isDirectory()) {
        const count = readdirSync(fullPath).length;
        console.log(`  ${entry}/ (${count} items)`);
      } else {
        console.log(`  ${entry}`);
      }
    }
  }
}
