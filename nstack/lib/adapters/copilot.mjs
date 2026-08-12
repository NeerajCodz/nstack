import { existsSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { BaseAdapter } from "./base.mjs";
import { readMcpManifest, toClaudeServer, mergeJsonFile } from "../mcp.mjs";

export class CopilotAdapter extends BaseAdapter {
  constructor() {
    const defaultHome = join(homedir(), ".copilot");
    super("copilot", defaultHome, "COPILOT_HOME", "copilot");
  }

  async init(cwd, projectHome) {
    const configDir = this.getConfigDir(cwd, projectHome);
    const dirs = ["agents", "skills", "commands"];
    for (const dir of dirs) {
      this.ensureDir(join(configDir, dir));
    }
    const settingsPath = join(configDir, "settings.json");
    if (!existsSync(settingsPath)) {
      writeFileSync(settingsPath, JSON.stringify({ permissions: {} }, null, 2) + "\n");
    }
  }

  async installAgent(cwd, agentFile, agentName, projectHome) {
    const destDir = join(this.getConfigDir(cwd, projectHome), "agents");
    this.ensureDir(destDir);
    cpSync(agentFile, join(destDir, `${agentName}.md`));
    console.log(`  Installed agent: ${agentName}`);
  }

  async installSkill(cwd, skillDir, skillName, projectHome) {
    const destDir = join(this.getConfigDir(cwd, projectHome), "skills", skillName);
    this.ensureDir(destDir);
    cpSync(skillDir, destDir, { recursive: true });
    console.log(`  Installed skill: ${skillName}`);
  }

  async installCommand(cwd, commandFile, commandName, projectHome) {
    const destDir = join(this.getConfigDir(cwd, projectHome), "commands");
    this.ensureDir(destDir);
    cpSync(commandFile, join(destDir, `${commandName}.md`));
    console.log(`  Installed command: ${commandName}`);
  }

  async installMcp(cwd, mcpFile, mcpName, projectHome) {
    const manifest = readMcpManifest(mcpFile);
    const settingsPath = join(this.getConfigDir(cwd, projectHome), "settings.json");
    mergeJsonFile(settingsPath, (settings) => ({
      ...settings,
      mcpServers: { ...(settings.mcpServers || {}), [mcpName]: toClaudeServer(manifest) },
    }));
    console.log(`  Installed MCP: ${mcpName}`);
  }

  async installPlugin(cwd, pluginDir, pluginName, projectHome) {
    const configDir = this.getConfigDir(cwd, projectHome);

    const agentsDir = join(pluginDir, "agents");
    if (existsSync(agentsDir)) {
      const destDir = join(configDir, "agents");
      this.ensureDir(destDir);
      for (const entry of readdirSync(agentsDir)) {
        if (entry.endsWith(".md")) {
          cpSync(join(agentsDir, entry), join(destDir, entry));
          console.log(`  Installed agent: ${basename(entry, ".md")}`);
        }
      }
    }

    const skillsDir = join(pluginDir, "skills");
    if (existsSync(skillsDir)) {
      const destDir = join(configDir, "skills");
      this.ensureDir(destDir);
      for (const entry of readdirSync(skillsDir)) {
        const skillPath = join(skillsDir, entry);
        if (statSync(skillPath).isDirectory()) {
          cpSync(skillPath, join(destDir, entry), { recursive: true });
          console.log(`  Installed skill: ${entry}`);
        }
      }
    }
  }

  async generate(cwd, componentsDir, projectHome) {
    console.log("Generating GitHub Copilot artifacts...");
    const configDir = this.getConfigDir(cwd, projectHome);

    const agentsSrc = join(componentsDir, "agents");
    if (existsSync(agentsSrc)) {
      const destDir = join(configDir, "agents");
      this.ensureDir(destDir);
      this.copyAgents(agentsSrc, destDir);
    }
    await this.generatePortable(cwd, componentsDir, projectHome);

    const pluginsSrc = join(componentsDir, "plugins");
    if (existsSync(pluginsSrc)) {
      for (const entry of readdirSync(pluginsSrc)) {
        const pluginDir = join(pluginsSrc, entry);
        if (statSync(pluginDir).isDirectory()) {
          await this.installPlugin(cwd, pluginDir, entry, projectHome);
        }
      }
    }
    console.log("Done.");
  }
}
