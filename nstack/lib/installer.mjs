import { existsSync, statSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { ensureConfig, addInstalledItem, removeInstalledItem, saveRegistry } from "./config.mjs";
import { getAdapter } from "./adapters/index.mjs";
import { buildRegistry, findComponent } from "./registry.mjs";
import { removeJsonMcp, removeTomlTable } from "./mcp.mjs";

const TYPE_ALIASES = {
  agents: "agent",
  skills: "skill",
  plugins: "plugin",
  commands: "command",
  hooks: "hook",
  mcps: "mcp",
};

function normalizeType(type) {
  return TYPE_ALIASES[type] || type;
}

function installedKey(type) {
  return `${normalizeType(type)}s`;
}

export async function install(cwd, requestedType, name, nstackRoot) {
  const type = normalizeType(requestedType);
  const config = ensureConfig(cwd);
  const projectHome = config.projectHome || false;

  const registry = buildRegistry(nstackRoot);
  saveRegistry(cwd, registry);

  const component = findComponent(registry, type, name);
  if (!component) {
    console.error(`Error: ${type}/${name} not found.`);
    console.error("Run 'nstack list available' to see what's available.");
    process.exit(1);
  }

  console.log(`Installing ${type}/${name} (${component.type || type}: ${component.source})...`);

  const tools = Object.keys(config.tools || {});
  if (tools.length === 0) {
    console.log("No tools initialized. Run 'nstack init <tool>' first.");
    return;
  }

  const sourcePath = resolve(nstackRoot, component.source);
  let installedTools = 0;
  for (const tool of tools) {
    const adapter = getAdapter(tool);
    if (!adapter) continue;
    console.log(`  -> ${tool}:`);
    try {
      if (type === "agent") await adapter.installAgent(cwd, sourcePath, name, projectHome);
      else if (type === "skill") await adapter.installSkill(cwd, sourcePath, name, projectHome);
      else if (type === "plugin") await adapter.installPlugin(cwd, sourcePath, name, projectHome);
      else if (type === "command") await adapter.installCommand(cwd, sourcePath, name, projectHome);
      else if (type === "mcp") await adapter.installMcp(cwd, sourcePath, name, projectHome);
      else throw new Error(`Unsupported component type: ${type}`);
      installedTools++;
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  addInstalledItem(cwd, installedKey(type), name, {
    ref: component.source,
    type: component.type || type,
    plugin: component.plugin || null,
  });

  console.log(`\nDone. Installed ${type}/${name} to ${installedTools} tool(s).`);
}

export async function uninstall(cwd, requestedType, name) {
  const type = normalizeType(requestedType);
  const config = ensureConfig(cwd);
  const projectHome = config.projectHome || false;
  const tools = Object.keys(config.tools || {});

  console.log(`Uninstalling ${type}/${name}...`);
  for (const tool of tools) {
    const adapter = getAdapter(tool);
    if (!adapter) continue;
    if (type === "mcp") {
      if (removeInstalledMcp(adapter, tool, cwd, name, projectHome)) {
        console.log(`  Removed MCP: ${name} (${tool})`);
      }
      continue;
    }

    const configDir = adapter.getConfigDir(cwd, projectHome);
    for (const path of getUninstallPaths(configDir, type, name)) {
      if (!existsSync(path)) continue;
      const { unlinkSync, rmSync } = await import("fs");
      if (statSync(path).isDirectory()) rmSync(path, { recursive: true });
      else unlinkSync(path);
      console.log(`  Removed: ${path}`);
    }
  }

  removeInstalledItem(cwd, installedKey(type), name);
  console.log("Done.");
}

function removeInstalledMcp(adapter, tool, cwd, name, projectHome) {
  const configDir = adapter.getConfigDir(cwd, projectHome);
  if (tool === "codex") return removeTomlTable(join(configDir, "config.toml"), `[mcp_servers.${name}]`);
  if (tool === "opencode") return removeJsonMcp(join(configDir, "opencode.json"), name);
  if (tool === "omp") return removeJsonMcp(join(configDir, "mcp.json"), name);
  if (tool === "claude") return removeJsonMcp(join(configDir, ".mcp.json"), name);
  if (tool === "cursor") return removeJsonMcp(join(configDir, "mcp.json"), name);
  return removeJsonMcp(join(configDir, "settings.json"), name);
}

export async function listAvailable(cwd, filterType, nstackRoot) {
  const registry = buildRegistry(nstackRoot);
  saveRegistry(cwd, registry);

  const filter = normalizeType(filterType || "");
  const show = (type) => !filter || filter === type;
  if (show("plugin")) {
    console.log("\nPLUGINS");
    console.log("=".repeat(60));
    for (const p of registry.plugins) {
      console.log(`  ${p.name} (${p.type}) v${p.version}`);
      if (p.description) console.log(`    ${p.description}`);
      if (p.agents.length) console.log(`    agents: ${p.agents.join(", ")}`);
      if (p.skills.length) console.log(`    skills: ${p.skills.join(", ")}`);
      if (p.commands.length) console.log(`    commands: ${p.commands.join(", ")}`);
      if (p.mcps.length) console.log(`    mcps: ${p.mcps.join(", ")}`);
      console.log();
    }
  }

  for (const [type, label] of [
    ["agent", "AGENTS"],
    ["skill", "SKILLS"],
    ["command", "COMMANDS"],
    ["mcp", "MCP SERVERS"],
  ]) {
    if (!show(type)) continue;
    const items = registry[`${type}s`] || [];
    console.log(`\n${label} (standalone)`);
    console.log("=".repeat(60));
    for (const item of items) {
      console.log(`  ${item.name}${item.description ? ` — ${item.description}` : ""}`);
      console.log(`    ${item.source}`);
    }
  }
}

function getUninstallPaths(configDir, type, name) {
  if (type === "agent") return [join(configDir, "agents", `${name}.md`), join(configDir, "agents", `${name}.toml`)];
  if (type === "skill") return [join(configDir, "skills", name)];
  if (type === "command") return [join(configDir, "commands", `${name}.md`), join(configDir, "skills", name)];
  return [];
}
