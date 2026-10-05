import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, basename } from "path";

const TYPE_ALIASES = {
  agents: "agent",
  skills: "skill",
  plugins: "plugin",
  commands: "command",
  hooks: "hook",
  mcps: "mcp",
};

export function buildRegistry(directoryRoot) {
  const registry = {
    agents: [],
    skills: [],
    plugins: [],
    commands: [],
    hooks: [],
    mcps: [],
  };

  if (!existsSync(directoryRoot)) return registry;

  scanAgents(join(directoryRoot, "agents"), registry.agents, directoryRoot);
  scanSkills(join(directoryRoot, "skills"), registry.skills, directoryRoot);
  scanCommands(join(directoryRoot, "commands"), registry.commands, directoryRoot);
  scanMcps(join(directoryRoot, "mcps"), registry.mcps, directoryRoot);
  scanPlugins(join(directoryRoot, "plugins"), registry.plugins, directoryRoot);

  return registry;
}

function sourcePath(root, filePath) {
  return relative(root, filePath).replace(/\\/g, "/");
}

function readFrontmatter(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    if (!content.startsWith("---")) return {};
    const end = content.indexOf("\n---", 3);
    if (end === -1) return {};

    const metadata = {};
    for (const line of content.slice(3, end).trim().split("\n")) {
      const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
      if (match) metadata[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
    return metadata;
  } catch {
    return {};
  }
}

function scanAgents(agentsDir, agents, root) {
  if (!existsSync(agentsDir)) return;
  for (const entry of readdirSync(agentsDir)) {
    const fullPath = join(agentsDir, entry);
    if (statSync(fullPath).isDirectory()) {
      scanAgents(fullPath, agents, root);
    } else if (entry.endsWith(".md")) {
      const metadata = readFrontmatter(fullPath);
      agents.push({
        name: metadata.name || basename(entry, ".md"),
        description: metadata.description || "",
        type: "standalone",
        source: sourcePath(root, fullPath),
      });
    }
  }
}

function scanSkills(skillsDir, skills, root) {
  if (!existsSync(skillsDir)) return;
  for (const entry of readdirSync(skillsDir)) {
    const skillDir = join(skillsDir, entry);
    const skillFile = join(skillDir, "SKILL.md");
    if (!statSync(skillDir).isDirectory() || !existsSync(skillFile)) continue;
    const metadata = readFrontmatter(skillFile);
    skills.push({
      name: metadata.name || entry,
      description: metadata.description || "",
      type: "standalone",
      source: sourcePath(root, skillDir),
    });
  }
}

function scanCommands(commandsDir, commands, root) {
  if (!existsSync(commandsDir)) return;
  for (const entry of readdirSync(commandsDir)) {
    const fullPath = join(commandsDir, entry);
    if (!statSync(fullPath).isDirectory() && entry.endsWith(".md")) {
      const metadata = readFrontmatter(fullPath);
      commands.push({
        name: metadata.name || basename(entry, ".md"),
        description: metadata.description || "",
        type: "standalone",
        source: sourcePath(root, fullPath),
      });
    }
  }
}

function scanMcps(mcpsDir, mcps, root) {
  if (!existsSync(mcpsDir)) return;
  for (const entry of readdirSync(mcpsDir)) {
    const fullPath = join(mcpsDir, entry);
    if (statSync(fullPath).isDirectory() || !entry.endsWith(".json")) continue;
    try {
      const manifest = JSON.parse(readFileSync(fullPath, "utf8"));
      if (!manifest.name || (!manifest.command && !manifest.url)) continue;
      mcps.push({
        ...manifest,
        type: "standalone",
        source: sourcePath(root, fullPath),
      });
    } catch {
      // Invalid catalog entries are ignored until validation reports them.
    }
  }
}

function scanPlugins(pluginsDir, plugins, root) {
  if (!existsSync(pluginsDir)) return;

  for (const entry of readdirSync(pluginsDir)) {
    const pluginDir = join(pluginsDir, entry);
    if (!statSync(pluginDir).isDirectory()) continue;

    const pluginJson = join(pluginDir, ".claude-plugin", "plugin.json");
    let manifest = {};
    if (existsSync(pluginJson)) {
      try { manifest = JSON.parse(readFileSync(pluginJson, "utf8")); } catch {}
    }

    const plugin = {
      name: manifest.name || entry,
      description: manifest.description || "",
      version: manifest.version || "1.0.0",
      type: "plugin",
      source: sourcePath(root, pluginDir),
      agents: [],
      skills: [],
      commands: [],
      mcps: [],
    };

    const agentsSub = join(pluginDir, "agents");
    if (existsSync(agentsSub)) {
      for (const f of readdirSync(agentsSub)) {
        if (f.endsWith(".md")) plugin.agents.push(basename(f, ".md"));
      }
    }

    const skillsSub = join(pluginDir, "skills");
    if (existsSync(skillsSub)) {
      for (const s of readdirSync(skillsSub)) {
        if (statSync(join(skillsSub, s)).isDirectory()) plugin.skills.push(s);
      }
    }

    const commandsSub = join(pluginDir, "commands");
    if (existsSync(commandsSub)) {
      for (const f of readdirSync(commandsSub)) {
        if (f.endsWith(".md")) plugin.commands.push(basename(f, ".md"));
      }
    }

    const mcpConfig = [".mcp.json", "mcp.json"]
      .map((name) => join(pluginDir, name))
      .find((path) => existsSync(path));
    if (mcpConfig) {
      try {
        const config = JSON.parse(readFileSync(mcpConfig, "utf8"));
        plugin.mcps = Object.keys(config.mcpServers || config.mcp || {});
      } catch {}
    }

    if (plugin.agents.length || plugin.skills.length || plugin.commands.length || plugin.mcps.length) {
      plugins.push(plugin);
    }
  }
}

export function findComponent(registry, requestedType, name) {
  const type = TYPE_ALIASES[requestedType] || requestedType;
  const collection = registry[`${type}s`];

  if (Array.isArray(collection)) {
    const local = collection.find((item) => item.name === name);
    if (local) return local;
  }

  for (const plugin of registry.plugins || []) {
    if (type === "plugin" && plugin.name === name) return plugin;
    if (type === "agent" && plugin.agents.includes(name)) {
      return {
        name,
        type: "plugin",
        source: `${plugin.source}/agents/${name}.md`,
        plugin: plugin.name,
      };
    }
    if (type === "skill" && plugin.skills.includes(name)) {
      return {
        name,
        type: "plugin",
        source: `${plugin.source}/skills/${name}`,
        plugin: plugin.name,
      };
    }
    if (type === "command" && plugin.commands.includes(name)) {
      return {
        name,
        type: "plugin",
        source: `${plugin.source}/commands/${name}.md`,
        plugin: plugin.name,
      };
    }
    if (type === "mcp" && plugin.mcps.includes(name)) {
      return {
        name,
        type: "plugin",
        source: `${plugin.source}/.mcp.json`,
        plugin: plugin.name,
      };
    }
  }

  return null;
}
