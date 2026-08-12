import { existsSync, cpSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { BaseAdapter } from "./base.mjs";
import { readMcpManifest, toClaudeServer, mergeJsonFile } from "../mcp.mjs";

export class CursorAdapter extends BaseAdapter {
  constructor() {
    super("cursor", join(homedir(), ".cursor"), "CURSOR_CONFIG_DIR", "cursor");
  }

  async init(cwd, projectHome) {
    const configDir = this.getConfigDir(cwd, projectHome);
    for (const dir of ["agents", "skills", "commands"]) this.ensureDir(join(configDir, dir));
    const mcpPath = join(configDir, "mcp.json");
    if (!existsSync(mcpPath)) writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }, null, 2) + "\n");
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
    const configPath = join(this.getConfigDir(cwd, projectHome), "mcp.json");
    mergeJsonFile(configPath, (config) => ({
      ...config,
      mcpServers: { ...(config.mcpServers || {}), [mcpName]: toClaudeServer(manifest) },
    }));
    console.log(`  Installed MCP: ${mcpName}`);
  }

  async installPlugin(cwd, pluginDir, pluginName, projectHome) {
    const configDir = this.getConfigDir(cwd, projectHome);
    for (const [sourceName, targetName] of [["agents", "agents"], ["skills", "skills"], ["commands", "commands"]]) {
      const source = join(pluginDir, sourceName);
      if (!existsSync(source)) continue;
      const dest = join(configDir, targetName);
      this.ensureDir(dest);
      for (const entry of readdirSync(source)) {
        const fullPath = join(source, entry);
        if (sourceName === "skills" && statSync(fullPath).isDirectory()) cpSync(fullPath, join(dest, entry), { recursive: true });
        else if (entry.endsWith(".md")) cpSync(fullPath, join(dest, entry));
      }
    }
  }

  async generate(cwd, componentsDir, projectHome) {
    console.log("Generating Cursor artifacts...");
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
        if (statSync(pluginDir).isDirectory()) await this.installPlugin(cwd, pluginDir, entry, projectHome);
      }
    }
    console.log("Done.");
  }
}
