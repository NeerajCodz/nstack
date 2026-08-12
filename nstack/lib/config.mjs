import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

export function getConfigPath(cwd) {
  return join(cwd, ".nstack", "config.json");
}

export function getConfigDir(cwd) {
  return join(cwd, ".nstack");
}

export function readConfig(cwd) {
  const p = getConfigPath(cwd);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function writeConfig(cwd, config) {
  const dir = getConfigDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(cwd), JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function ensureConfig(cwd) {
  let config = readConfig(cwd);
  if (!config) {
    config = createDefaultConfig();
    writeConfig(cwd, config);
  }
  return config;
}

export function createDefaultConfig() {
  return {
    version: "1.1.0",
    initialized: new Date().toISOString(),
    projectHome: false,
    tools: {},
    installed: {
      agents: [],
      skills: [],
      plugins: [],
      hooks: [],
      commands: [],
      mcps: [],
    },
    registry: null,
  };
}

export function addInstalledItem(cwd, type, name, ref = {}) {
  const config = ensureConfig(cwd);
  if (!config.installed[type]) config.installed[type] = [];

  const existing = config.installed[type].find((i) => i.name === name);
  if (existing) {
    existing.updated = new Date().toISOString();
    Object.assign(existing, ref);
  } else {
    config.installed[type].push({
      name,
      installed: new Date().toISOString(),
      ...ref,
    });
  }
  writeConfig(cwd, config);
  return config;
}

export function removeInstalledItem(cwd, type, name) {
  const config = ensureConfig(cwd);
  if (!config.installed[type]) return config;
  config.installed[type] = config.installed[type].filter((i) => i.name !== name);
  writeConfig(cwd, config);
  return config;
}

export function isInstalled(cwd, type, name) {
  const config = readConfig(cwd);
  if (!config?.installed?.[type]) return false;
  return config.installed[type].some((i) => i.name === name);
}

export function getToolConfig(cwd, tool) {
  const config = readConfig(cwd);
  return config?.tools?.[tool] || null;
}

export function setToolConfig(cwd, tool, toolConfig) {
  const config = ensureConfig(cwd);
  if (!config.tools) config.tools = {};
  config.tools[tool] = { ...toolConfig, initialized: new Date().toISOString() };
  writeConfig(cwd, config);
  return config;
}

export function setProjectHome(cwd, enabled) {
  const config = ensureConfig(cwd);
  config.projectHome = enabled;
  writeConfig(cwd, config);
  return config;
}

export function saveRegistry(cwd, registry) {
  const config = ensureConfig(cwd);
  config.registry = registry;
  writeConfig(cwd, config);
  return config;
}
