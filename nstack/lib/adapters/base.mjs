import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { readMcpManifest } from "../mcp.mjs";

export class BaseAdapter {
  constructor(toolName, defaultHome, envVar, projectDir) {
    this.toolName = toolName;
    this.defaultHome = defaultHome;
    this.envVar = envVar;
    this.projectDir = projectDir;
  }

  getConfigDir(cwd, projectHome) {
    if (projectHome) {
      return join(cwd, ".nstack", this.projectDir);
    }
    return this.defaultHome;
  }

  async init(cwd, projectHome) {}

  async installAgent(cwd, agentFile, agentName, projectHome) {}

  async installSkill(cwd, skillDir, skillName, projectHome) {}

  async installPlugin(cwd, pluginDir, pluginName, projectHome) {}

  async installCommand(cwd, commandFile, commandName, projectHome) {
    const destDir = join(this.getConfigDir(cwd, projectHome), "commands");
    this.ensureDir(destDir);
    cpSync(commandFile, join(destDir, `${commandName}.md`));
    console.log(`  Installed command: ${commandName}`);
  }

  async installMcp(cwd, mcpFile, mcpName, projectHome) {
    throw new Error(`${this.toolName} does not implement MCP installation`);
  }

  async generate(cwd, componentsDir, projectHome) {}

  async generatePortable(cwd, componentsDir, projectHome) {
    const skillsDir = join(componentsDir, "skills");
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir)) {
        const skillDir = join(skillsDir, entry);
        if (statSync(skillDir).isDirectory() && existsSync(join(skillDir, "SKILL.md"))) {
          await this.installSkill(cwd, skillDir, entry, projectHome);
        }
      }
    }

    const commandsDir = join(componentsDir, "commands");
    if (existsSync(commandsDir)) {
      for (const entry of readdirSync(commandsDir)) {
        const commandFile = join(commandsDir, entry);
        if (!statSync(commandFile).isDirectory() && entry.endsWith(".md")) {
          await this.installCommand(cwd, commandFile, entry.slice(0, -3), projectHome);
        }
      }
    }

    const mcpsDir = join(componentsDir, "mcps");
    if (existsSync(mcpsDir)) {
      for (const entry of readdirSync(mcpsDir)) {
        const mcpFile = join(mcpsDir, entry);
        if (statSync(mcpFile).isDirectory() || !entry.endsWith(".json")) continue;
        const manifest = readMcpManifest(mcpFile);
        if (manifest.enabledByDefault !== false) {
          await this.installMcp(cwd, mcpFile, manifest.name, projectHome);
        }
      }
    }
  }

  async copyPluginResources(cwd, pluginDir, projectHome) {
    const configDir = this.getConfigDir(cwd, projectHome);
    const hooksJson = join(pluginDir, "hooks", "hooks.json");
    if (existsSync(hooksJson)) {
      const destDir = join(configDir, "hooks");
      this.ensureDir(destDir);
      cpSync(hooksJson, join(destDir, "hooks.json"));
    }
    const scriptsDir = join(pluginDir, "scripts");
    if (existsSync(scriptsDir)) {
      const destDir = join(configDir, "scripts");
      this.ensureDir(destDir);
      cpSync(scriptsDir, destDir, { recursive: true });
    }
  }

  ensureDir(dir) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  copyAgents(src, dest) {
    const walk = (dir) => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
          walk(fullPath);
        } else if (entry.endsWith(".md")) {
          cpSync(fullPath, join(dest, entry));
        }
      }
    };
    walk(src);
  }

  copyDir(src, dest) {
    this.ensureDir(dest);
    cpSync(src, dest, { recursive: true });
  }

  readJson(filePath, fallback = {}) {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  }

  writeJson(filePath, value) {
    this.ensureDir(join(filePath, ".."));
    writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
  }
}
