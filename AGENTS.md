# AGENTS.md

## Project

`nstack` is a portable component manager for AI coding harnesses. Keep shared
behavior in this file and let each adapter generate native configuration.

## Supported harnesses

Claude Code, OpenAI Codex, OpenCode, Oh My Pi, Antigravity CLI, Gemini CLI,
Cursor, and GitHub Copilot. See the canonical [nstack-directory catalog](https://github.com/NeerajCodz/nstack-directory/blob/main/catalog/ai-stack.json) for documentation and installation links.

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
bun --bun nstack/bin/nstack.mjs init git
bun --bun nstack/bin/nstack.mjs init --project-home codex
bun --bun nstack/bin/nstack.mjs refresh
bun --bun nstack/bin/nstack.mjs list available
bun --bun nstack/bin/nstack.mjs search web security
bun --bun nstack/bin/nstack.mjs install mcp/context7
bun --bun nstack/bin/nstack.mjs generate codex
```

Portable authoring rules are maintained in the [nstack-directory authoring guide](https://github.com/NeerajCodz/nstack-directory/blob/main/docs/authoring.md).

## Canonical nstack-directory layout

- Agents: `agents/**/*.md`
- Skills: `skills/<name>/SKILL.md`
- Plugins: `plugins/<name>/`
- MCP manifests: `mcps/<name>.json`
- Shared hooks: `hooks/`
- Commands: `commands/`
- Other shared material: `templates/`, `catalog/`, `docs/`, and `tools/`

The canonical source is [nstack-directory](https://github.com/NeerajCodz/nstack-directory).
`nstack install type/name` resolves from its cached checkout under `~/.nstack/directory`;
`nstack refresh` updates that checkout. Git is required for remote folder downloads.

```bash
nstack plugins add https://github.com/NeerajCodz/nstack-directory/tree/main/plugins/web-scripting
nstack skills add https://github.com/NeerajCodz/nstack-directory/tree/main/skills/security-review
```

Remote `add` also supports `agents`, `commands`, and `mcps`. Review remote component
instructions, manifests, hooks, and scripts before use; nstack does not execute them.
