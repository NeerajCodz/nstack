import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createDefaultConfig, writeConfig, ensureConfig, setToolConfig, setProjectHome } from "./config.mjs";
import { getAdapter } from "./adapters/index.mjs";
import { ensureProjectAgents } from "./project-guidance.mjs";

const TOOL_DESCRIPTIONS = {
  claude: "Claude Code (Anthropic official) — CLAUDE_CONFIG_DIR",
  openclaude: "OpenClaude (community) — OPENCLAUDE_CONFIG_DIR",
  codex: "OpenAI Codex CLI — CODEX_HOME",
  gemini: "Gemini CLI — GEMINI_HOME",
  agy: "Google Antigravity CLI — GEMINI_HOME",
  antigravity: "Google Antigravity CLI (agy alias) — GEMINI_HOME",
  opencode: "OpenCode — OPENCODE_CONFIG_DIR",
  omp: "oh-my-pi — PI_CONFIG_DIR",
  cursor: "Cursor — CURSOR_CONFIG_DIR",
  copilot: "GitHub Copilot — COPILOT_HOME",
};

const NSTACK_DIRS = ["agents", "skills", "plugins", "hooks", "commands", "memory", "agent-memory", "scripts"];

export async function initProject(cwd, componentsDir, projectHome) {
  const nstackDir = join(cwd, ".nstack");
  if (!existsSync(nstackDir)) mkdirSync(nstackDir, { recursive: true });
  ensureProjectAgents(cwd);

  for (const dir of NSTACK_DIRS) {
    const dirPath = join(nstackDir, dir);
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  }

  const config = createDefaultConfig();
  config.projectHome = projectHome;
  writeConfig(cwd, config);

  console.log("nstack initialized in .nstack/");

  if (projectHome) {
    console.log("\nMode: project-home (configs will be in .nstack/<tool>/)");
    console.log("Set these env vars in your shell or .env:");
    console.log("  CLAUDE_CONFIG_DIR=.nstack/claude");
    console.log("  OPENCLAUDE_CONFIG_DIR=.nstack/openclaude");
    console.log("  CODEX_HOME=.nstack/codex");
    console.log("  GEMINI_HOME=.nstack/gemini (also agy)");
    console.log("  OPENCODE_CONFIG_DIR=.nstack/opencode");
    console.log("  PI_CONFIG_DIR=.nstack/omp");
    console.log("  CURSOR_CONFIG_DIR=.nstack/cursor");
    console.log("  COPILOT_HOME=.nstack/copilot");
  } else {
    console.log("\nMode: default-home (configs in ~/.claude, ~/.codex, etc.)");
    console.log("Use 'nstack init --project-home' to keep everything in .nstack/");
  }

  console.log("\nNext steps:");
  console.log("  nstack init claude      — set up for Claude Code");
  console.log("  nstack init codex       — set up for OpenAI Codex");
  console.log("  nstack init omp        — set up for oh-my-pi");
  console.log("  nstack init agy        — set up for Antigravity CLI");
  console.log("  nstack init opencode   — set up for OpenCode");
  console.log("  nstack init gemini     — set up for Gemini CLI");
  console.log("  nstack init cursor     — set up for Cursor");
  console.log("  nstack init copilot    — set up for GitHub Copilot");
  console.log("\nThen install components:");
  console.log("  nstack install agent/backend-developer");
  console.log("  nstack install plugin/frontend");
  console.log("  nstack install skill/review");
}

export async function initHarness(cwd, tool, componentsDir) {
  const supportedTools = Object.keys(TOOL_DESCRIPTIONS);
  if (!supportedTools.includes(tool)) {
    console.error(`Unknown tool: ${tool}`);
    console.error(`Supported: ${supportedTools.join(", ")}`);
    process.exit(1);
  }

  const config = ensureConfig(cwd);
  const projectHome = config.projectHome || false;
  const adapter = getAdapter(tool);

  if (!adapter) {
    console.error(`No adapter for ${tool}`);
    process.exit(1);
  }

  await adapter.init(cwd, projectHome);

  setToolConfig(cwd, tool, {
    name: tool,
    description: TOOL_DESCRIPTIONS[tool],
    configDir: adapter.getConfigDir(cwd, projectHome),
    envVar: adapter.envVar,
  });

  const configDir = adapter.getConfigDir(cwd, projectHome);
  console.log(`\nInitialized for ${TOOL_DESCRIPTIONS[tool]}`);
  console.log(`Config dir: ${configDir}`);

  if (projectHome) {
    console.log(`Set env: ${adapter.envVar}=.nstack/${adapter.projectDir}`);
  }

  console.log(`Run 'nstack generate ${tool}' to generate artifacts.`);
}
