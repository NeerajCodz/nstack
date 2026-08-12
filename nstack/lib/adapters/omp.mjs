import { existsSync, cpSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { BaseAdapter } from "./base.mjs";
import { readMcpManifest, toOmpServer, mergeJsonFile } from "../mcp.mjs";

export class OmpAdapter extends BaseAdapter {
  constructor() {
    super("omp", join(homedir(), ".omp", "agent"), "PI_CONFIG_DIR", "omp");
  }

  async init(cwd, projectHome) {
    const configDir = this.getConfigDir(cwd, projectHome);
    for (const dir of ["agents", "skills", "commands", "plugins"]) {
      this.ensureDir(join(configDir, dir));
    }
    const mcpPath = join(configDir, "mcp.json");
    if (!existsSync(mcpPath)) {
      writeFileSync(mcpPath, JSON.stringify({
        "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
        mcpServers: {},
      }, null, 2) + "\n");
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
    const configPath = join(this.getConfigDir(cwd, projectHome), "mcp.json");
    mergeJsonFile(configPath, (config) => ({
      "$schema": config.$schema || "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
      ...config,
      mcpServers: { ...(config.mcpServers || {}), [mcpName]: toOmpServer(manifest) },
    }));
    console.log(`  Installed MCP: ${mcpName}`);
  }

  async installPlugin(cwd, pluginDir, pluginName, projectHome) {
    const configDir = this.getConfigDir(cwd, projectHome);
    this.copyPluginAgents(pluginDir, configDir);
    this.copyPluginSkills(pluginDir, configDir);
    this.copyPluginCommands(pluginDir, configDir);
    await this.copyPluginResources(cwd, pluginDir, projectHome);
  }

  copyPluginAgents(pluginDir, configDir) {
    const source = join(pluginDir, "agents");
    if (!existsSync(source)) return;
    const dest = join(configDir, "agents");
    this.ensureDir(dest);
    for (const entry of readdirSync(source)) {
      if (entry.endsWith(".md")) cpSync(join(source, entry), join(dest, entry));
    }
  }

  copyPluginSkills(pluginDir, configDir) {
    const source = join(pluginDir, "skills");
    if (!existsSync(source)) return;
    const dest = join(configDir, "skills");
    this.ensureDir(dest);
    for (const entry of readdirSync(source)) {
      const fullPath = join(source, entry);
      if (statSync(fullPath).isDirectory()) cpSync(fullPath, join(dest, entry), { recursive: true });
    }
  }

  copyPluginCommands(pluginDir, configDir) {
    const source = join(pluginDir, "commands");
    if (!existsSync(source)) return;
    const dest = join(configDir, "commands");
    this.ensureDir(dest);
    for (const entry of readdirSync(source)) {
      if (entry.endsWith(".md")) cpSync(join(source, entry), join(dest, entry));
    }
  }

  async generate(cwd, componentsDir, projectHome) {
    console.log("Generating oh-my-pi artifacts...");
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
