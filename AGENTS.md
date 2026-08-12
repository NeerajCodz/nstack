# AGENTS.md

## Project

`nstack` is a portable component manager for AI coding harnesses. Keep shared
behavior in this file and let each adapter generate native configuration.

## Supported harnesses

Claude Code, OpenAI Codex, OpenCode, Oh My Pi, Antigravity CLI, Gemini CLI,
Cursor, and GitHub Copilot. See `components/catalog/ai-stack.json` for current
documentation and installation links.

## Working rules

- Inspect existing patterns before editing.
- Prefer the smallest change that satisfies the request.
- Keep secrets in environment variables; never commit credentials.
- Treat remote plugins, skills, and MCP servers as untrusted until reviewed.
- Prefer official repositories and the MCP registry; pin package versions for
  production deployments.
- Verify behavioral changes with a focused command or test.
- Do not bypass hooks or safety checks with `--no-verify` or equivalent flags.

## nstack commands

```bash
node nstack/bin/nstack.mjs init --project-home codex
node nstack/bin/nstack.mjs refresh
node nstack/bin/nstack.mjs list available
node nstack/bin/nstack.mjs install mcp/context7
node nstack/bin/nstack.mjs generate codex
```

## Portable component conventions

- Agents: `components/agents/**/*.md`
- Skills: `components/skills/<name>/SKILL.md`
- Plugins: `components/plugins/<name>/`
- MCP manifests: `components/mcps/<name>.json`
- Shared hooks: `components/hooks/`
- Commands: `components/commands/`
