import { existsSync, lstatSync, statSync, readdirSync, mkdtempSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { ensureConfig, addInstalledItem, removeInstalledItem, saveRegistry } from "./config.mjs";
import { getAdapter } from "./adapters/index.mjs";
import { buildRegistry, findComponent } from "./registry.mjs";
import { readMcpManifest, removeJsonMcp, removeTomlTable } from "./mcp.mjs";

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

const REMOTE_TYPES = new Set(["plugin", "skill", "agent", "command", "mcp"]);
const URL_CATEGORIES = {
  plugins: "plugin",
  plugin: "plugin",
  skills: "skill",
  skill: "skill",
  agents: "agent",
  agent: "agent",
  commands: "command",
  command: "command",
  mcps: "mcp",
  mcp: "mcp",
};

export function parseGitHubFolderUrl(value, requestedType) {
  const type = normalizeType(requestedType);
  if (!REMOTE_TYPES.has(type)) throw new Error(`Unsupported remote component type: ${requestedType}`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Expected an HTTPS GitHub tree URL: https://github.com/<owner>/<repo>/tree/<ref>/<path>");
  }
  if (
    url.protocol !== "https:" || url.hostname !== "github.com" || url.port ||
    url.username || url.password || url.search || url.hash || url.pathname.includes("%") ||
    url.pathname.includes("\\")
  ) {
    throw new Error("Expected an HTTPS GitHub tree URL: https://github.com/<owner>/<repo>/tree/<ref>/<path>");
  }
  const parts = url.pathname.split("/").slice(1);
  const [owner, repo, tree, ref, ...pathParts] = parts;
  if (
    !owner || !repo || tree !== "tree" || !ref || pathParts.length < 2 ||
    [...parts].some((part) => !part || part === "." || part === "..") ||
    !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)
  ) {
    throw new Error("GitHub URL must include owner, repository, a single-segment ref, and a component folder path.");
  }
  const categoryType = URL_CATEGORIES[pathParts[0]];
  if (!categoryType && pathParts.slice(1).some((part) => URL_CATEGORIES[part])) {
    throw new Error("GitHub refs must be a single path segment; slash-containing branch refs are not supported.");
  }
  if (!categoryType || categoryType !== type) {
    throw new Error(`GitHub folder category must be ${type}s/ (singular spelling is also accepted).`);
  }
  return { owner, repo, ref, path: pathParts.join("/"), type };
}

function cloneSparseCheckout(_url, destination, parsed) {
  const repository = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
  try {
    execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", parsed.ref, repository, destination], { stdio: "pipe" });
    execFileSync("git", ["-C", destination, "sparse-checkout", "set", parsed.path], { stdio: "pipe" });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`GitHub folder download failed: ${detail}`);
  }
}

async function installComponent(cwd, type, sourcePath, name, projectHome, tools, getAdapterForTool, strict = false) {
  let installedTools = 0;
  for (const tool of tools) {
    const adapter = getAdapterForTool(tool);
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
      if (strict) throw err;
    }
  }
  return installedTools;
}

export async function install(cwd, requestedType, name, directoryRoot) {
  const type = normalizeType(requestedType);
  const config = ensureConfig(cwd);
  const projectHome = config.projectHome || false;

  const registry = buildRegistry(directoryRoot);
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

  const sourcePath = resolve(directoryRoot, component.source);
  const installedTools = await installComponent(
    cwd,
    type,
    sourcePath,
    name,
    projectHome,
    tools,
    getAdapter,
  );

  addInstalledItem(cwd, installedKey(type), name, {
    ref: component.source,
    type: component.type || type,
    plugin: component.plugin || null,
  });

  console.log(`\nDone. Installed ${type}/${name} to ${installedTools} tool(s).`);
}

export async function installRemoteFolder(cwd, requestedType, url, dependencies = {}) {
  const parsed = parseGitHubFolderUrl(url, requestedType);
  const type = parsed.type;
  const config = ensureConfig(cwd);
  const projectHome = config.projectHome || false;
  const tools = Object.keys(config.tools || {});
  if (tools.length === 0) {
    console.log("No tools initialized. Run 'nstack init <tool>' first.");
    return [];
  }

  const createTempDirectory = dependencies.createTempDirectory ||
    ((prefix) => mkdtempSync(prefix));
  const removeTempDirectory = dependencies.removeTempDirectory ||
    ((directory) => rmSync(directory, { recursive: true, force: true }));
  const cloneCheckout = dependencies.cloneCheckout || cloneSparseCheckout;
  const getAdapterForTool = dependencies.getAdapterForTool || getAdapter;
  const tempDir = createTempDirectory(join(tmpdir(), "nstack-remote-"));

  try {
    await cloneCheckout(url, tempDir, parsed);
    const selectedPath = join(tempDir, ...parsed.path.split("/"));
    if (!existsSync(selectedPath) || !lstatSync(selectedPath).isDirectory()) {
      throw new Error(`GitHub folder does not exist: ${parsed.path}`);
    }

    let items;
    if (type === "plugin") {
      items = [{ name: parsed.path.split("/").at(-1), sourcePath: selectedPath, ref: parsed.path }];
    } else if (type === "skill") {
      if (!existsSync(join(selectedPath, "SKILL.md"))) {
        throw new Error(`Skill folder must contain SKILL.md: ${parsed.path}`);
      }
      items = [{ name: parsed.path.split("/").at(-1), sourcePath: selectedPath, ref: parsed.path }];
    } else {
      const extension = type === "mcp" ? ".json" : ".md";
      items = readdirSync(selectedPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name.slice(0, -extension.length),
          sourcePath: join(selectedPath, entry.name),
          ref: `${parsed.path}/${entry.name}`,
        }));
      if (type === "mcp") {
        for (const item of items) readMcpManifest(item.sourcePath);
      }
      if (items.length === 0) {
        throw new Error(`No direct-child ${extension} files found in ${parsed.path}.`);
      }
    }

    for (const item of items) {
      const installedTools = await installComponent(
        cwd,
        type,
        item.sourcePath,
        item.name,
        projectHome,
        tools,
        getAdapterForTool,
        true,
      );
      addInstalledItem(cwd, installedKey(type), item.name, {
        ref: item.ref,
        type: "remote",
        url,
      });
      console.log(`Installed ${type}/${item.name} to ${installedTools} tool(s).`);
    }
    return items.map(({ name }) => name);
  } finally {
    removeTempDirectory(tempDir);
  }
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

export async function listAvailable(cwd, filterType, directoryRoot) {
  const registry = buildRegistry(directoryRoot);
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
