#!/usr/bin/env node
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readConfig, ensureConfig, saveRegistry } from "../lib/config.mjs";
import { initProject, initHarness } from "../lib/init.mjs";
import { initGit } from "../lib/git.mjs";
import { install, uninstall, listAvailable } from "../lib/installer.mjs";
import { listInstalled } from "../lib/list.mjs";
import { generateArtifacts } from "../lib/generate.mjs";
import { ensureGh } from "../lib/tools.mjs";
import { linear as linearCommand, formatLinearResult, formatLinearError, formatLinearHumanError } from "../lib/linear.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NSTACK_ROOT = resolve(__dirname, "../..");
const COMPONENTS_DIR = resolve(NSTACK_ROOT, "components");

const HELP = `
nstack — Multi-harness agent/plugin/skill manager

  nstack init [--project-home] [tool]   Initialize nstack or a harness
  nstack init git [options]             Initialize Git and GitHub scaffolding
  nstack install <type>/<name>          Install agent, skill, plugin, command, or MCP
  nstack uninstall <type>/<name>        Uninstall an item
  nstack tools ensure gh               Check GitHub CLI/auth; install only if absent
  nstack linear <cmd>                  Work with Linear issues and teams
  nstack linear --help             Show Linear commands and pagination rules
  nstack linear auth login|status|logout
  nstack linear issue|search|list|list-issues [options]
  nstack linear team|project|create|save-issue|relation [options]
  nstack linear status|assignee|priority|estimate|due-date|label [options]
  nstack linear comment|attach [options]
  nstack status                         Show project status

Options:
  --project-home    Keep all configs in .nstack/<tool>/ instead of ~/.<tool>/
  --branch <name>   Set the initial Git branch (default: main)
  --force           Overwrite existing generated files
Tools: claude, codex, omp, agy, opencode, gemini, cursor, copilot, openclaude
Types: agent, skill, plugin, command, mcp

Linear configuration:
  NSTACK_LINEAR_CONVEX_URL  Convex HTTP endpoint used for all Linear API requests
  NSTACK_LINEAR_WEB_URL      nstack web application used for OAuth login
  LINEAR_API_KEY             Optional explicit API-key override; otherwise use OAuth
  Add --json to Linear commands for machine-readable output

Default home directories:
  Claude Code    ~/.claude          (CLAUDE_CONFIG_DIR)
  Codex CLI      ~/.codex           (CODEX_HOME)
  oh-my-pi      ~/.omp/agent       (PI_CONFIG_DIR)
  Antigravity   ~/.gemini          (GEMINI_HOME)
  OpenCode      ~/.config/opencode (OPENCODE_CONFIG_DIR)
  Gemini CLI    ~/.gemini          (GEMINI_HOME)
  Cursor        ~/.cursor          (CURSOR_CONFIG_DIR)
  GitHub Copilot ~/.copilot         (COPILOT_HOME)

Examples:
  nstack init git
  nstack init git --branch main
  nstack init git --force
  nstack tools ensure gh
  nstack install agent/backend-developer
  nstack install plugin/backend-development
  nstack list available
`;

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const separator = raw.indexOf("=");
    if (separator !== -1) {
      flags[raw.slice(0, separator)] = raw.slice(separator + 1);
    } else if (raw === "branch" && args[index + 1] && !args[index + 1].startsWith("--")) {
      flags.branch = args[index + 1];
      index += 1;
    } else {
      flags[raw] = true;
    }
  }
  return { flags, positional };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const { flags, positional } = parseArgs(args);
  const command = positional[0];
  const rest = positional.slice(1);

  switch (command) {
    case "init": {
      const tool = rest[0];
      const projectHome = flags["project-home"] || false;
      if (tool === "git") {
        await initGit(process.cwd(), COMPONENTS_DIR, {
          branch: typeof flags.branch === "string" ? flags.branch : undefined,
          force: flags.force,
        });
      } else if (tool) {
        await initHarness(process.cwd(), tool, COMPONENTS_DIR);
      } else {
        await initProject(process.cwd(), COMPONENTS_DIR, projectHome);
      }
      break;
    }

    case "install": {
      if (rest.length === 0) {
        console.error("Error: specify what to install (e.g., agent/backend-developer)");
        process.exit(1);
      }
      const [type, name] = rest[0].split("/");
      if (!type || !name) {
        console.error("Error: use format type/name (e.g., agent/backend-developer)");
        process.exit(1);
      }
      await install(process.cwd(), type, name, NSTACK_ROOT);
      break;
    }

    case "uninstall": {
      if (rest.length === 0) {
        console.error("Error: specify what to uninstall");
        process.exit(1);
      }
      const [type, name] = rest[0].split("/");
      if (!type || !name) {
        console.error("Error: use format type/name");
        process.exit(1);
      }
      await uninstall(process.cwd(), type, name);
      break;
    }

    case "list": {
      const target = rest[0];
      if (target === "available" || target === "all") {
        await listAvailable(process.cwd(), rest[1], NSTACK_ROOT);
      } else {
        await listInstalled(process.cwd(), target);
      }
      break;
    }

    case "refresh": {
      console.log("Rebuilding component registry...");
      const registry = buildRegistry(NSTACK_ROOT);
      saveRegistry(process.cwd(), registry);
      console.log(
        `Found ${registry.agents.length} agents, ${registry.skills.length} skills, ` +
        `${registry.plugins.length} plugins, ${registry.commands.length} commands, ` +
        `${registry.mcps.length} MCP servers.`,
      );
      break;
    }

    case "generate": {
      await generateArtifacts(process.cwd(), rest[0], COMPONENTS_DIR);
      break;
    }

    case "tools": {
      if (rest[0] !== "ensure" || rest[1] !== "gh") {
        console.error("Usage: nstack tools ensure gh");
        process.exit(1);
      }
      const result = await ensureGh();
      if (!result.authenticated) process.exitCode = 1;
      break;
    }

    case "linear": {
      const linearArgs = args.slice(1);
      const json = linearArgs.includes("--json");
      const controller = new AbortController();
      const onInterrupt = () => controller.abort();
      const isLogin = linearArgs[0] === "auth" && linearArgs[1] === "login";
      if (isLogin) process.once("SIGINT", onInterrupt);
      try {
        const result = await linearCommand(linearArgs, { signal: controller.signal });
        console.log(result.json ? JSON.stringify(result.data) : formatLinearResult(result.data));
      } catch (error) {
        console.error(json ? JSON.stringify({ error: formatLinearError(error) }) : formatLinearHumanError(error));
        process.exitCode = 1;
      } finally {
        if (isLogin) process.removeListener("SIGINT", onInterrupt);
      }
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
