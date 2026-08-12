import { readConfig } from "./config.mjs";

export async function listInstalled(cwd, filterType) {
  const config = readConfig(cwd);
  if (!config) {
    console.log("No nstack config found. Run 'nstack init' first.");
    return;
  }

  const types = filterType
    ? [`${filterType.replace(/s$/, "")}s`]
    : ["agents", "skills", "plugins", "hooks", "commands", "mcps"];

  let total = 0;

  for (const type of types) {
    const items = config.installed?.[type] || [];
    if (items.length === 0) continue;

    console.log(`\n${type.toUpperCase()}`);
    console.log("-".repeat(40));

    for (const item of items) {
      console.log(`  ${item.name}`);
      if (item.ref) console.log(`    ref: ${item.ref}`);
      if (item.type) console.log(`    source: ${item.type}`);
      if (item.plugin) console.log(`    plugin: ${item.plugin}`);
      total++;
    }
  }

  if (total === 0) {
    console.log("No components installed.");
    console.log("\nInstall with:");
    console.log("  nstack install agent/<name>");
    console.log("  nstack install skill/<name>");
    console.log("  nstack install plugin/<name>");
    console.log("  nstack install mcp/<name>");
  }

  const tools = Object.keys(config.tools || {});
  if (tools.length > 0) {
    console.log(`\nINITIALIZED TOOLS`);
    console.log("-".repeat(40));
    for (const tool of tools) {
      const desc = config.tools[tool].description || tool;
      console.log(`  ${tool}: ${desc}`);
    }
  }
}
