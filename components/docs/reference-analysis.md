# Reference Repository Analysis

## Overview

The `_reference/agents-main` repository is a **production-ready agentic plugin marketplace** with:

- **83 plugins** (81 local + 2 external)
- **191 agents** (domain experts)
- **155 skills** (modular knowledge packages)
- **102 commands** (slash commands)

Built for **Claude Code** and consumed natively by:
- OpenAI Codex CLI
- Cursor
- OpenCode
- Gemini CLI
- GitHub Copilot

## Architecture

### Core Principles

1. **Single source of truth** — All authoring happens in `plugins/<name>/`
2. **One canonical context file** — `AGENTS.md` at repo root
3. **Adapters own per-harness mechanics** — Source content stays portable
4. **Mechanical enforcement** — Every lint finding ships with a fix hint
5. **Progressive disclosure** — Context files cap at ~150 lines

### Directory Structure

```
_reference/agents-main/agents-main/
├── AGENTS.md                    # Canonical context file
├── CLAUDE.md                    # Symlink → AGENTS.md
├── ARCHITECTURE.md              # Architecture index
├── GEMINI.md                    # Gemini-specific setup
├── CONTRIBUTING.md              # Contributor guide
├── Makefile                     # Build & adapter commands
├── gemini-extension.json        # Gemini extension manifest
├── .claude-plugin/
│   └── marketplace.json         # Plugin registry (40KB)
├── .agents/plugins/
│   └── marketplace.json         # Codex marketplace
├── .gemini/
│   └── settings.json            # Gemini CLI settings
├── .cursor/
│   └── rules/                   # Cursor rules (.mdc)
├── .cursor-plugin/
│   ├── marketplace.json         # Cursor marketplace
│   ├── plugin.json              # Plugin manifest
│   └── plugins/                 # Plugin registry
├── plugins/                     # SOURCE OF TRUTH (81 plugins)
│   └── <name>/
│       ├── .claude-plugin/
│       │   └── plugin.json      # Claude plugin manifest
│       ├── .codex-plugin/
│       │   └── plugin.json      # Codex plugin manifest
│       ├── agents/*.md          # Agent definitions
│       ├── skills/<n>/          # Skill directories
│       │   ├── SKILL.md         # Skill definition
│       │   ├── references/      # Supporting docs
│       │   └── assets/          # Templates
│       └── commands/*.md        # Slash commands
├── tools/
│   ├── adapters/                # Per-harness adapter framework
│   │   ├── base.py              # Parser, HarnessAdapter ABC
│   │   ├── capabilities.py      # Capability matrix
│   │   ├── codex.py             # Codex adapter
│   │   ├── copilot.py           # Copilot adapter
│   │   ├── cursor.py            # Cursor adapter
│   │   ├── gemini.py            # Gemini adapter
│   │   └── opencode.py          # OpenCode adapter
│   ├── generate.py              # Unified CLI
│   ├── validate_generated.py    # Structural validation
│   ├── doc_gardener.py          # Drift detection
│   ├── install_copilot.py       # Copilot installer
│   ├── install_opencode.py      # OpenCode installer
│   └── tests/                   # Test suite (386 tests)
└── docs/
    ├── architecture.md          # Full architecture
    ├── plugins.md               # Plugin catalog
    ├── agents.md                # Agent catalog
    ├── agent-skills.md          # Skill catalog
    ├── usage.md                 # User workflows
    ├── authoring.md             # Style guide
    ├── harnesses.md             # Capability matrix
    ├── plugin-eval.md           # Quality framework
    └── round-trip-results.md    # Verification recipes
```

## Plugin Component Model

Each plugin has three component types:

### Agents (`agents/<name>.md`)

Domain experts with frontmatter:
```yaml
---
name: python-pro
description: "Use PROACTIVELY when Python code needs expert review or implementation"
model: opus|sonnet|haiku|inherit
tools: [Read, Edit, Write, Bash]
color: blue
---
```

### Skills (`skills/<n>/SKILL.md`)

Modular knowledge with progressive disclosure:
```yaml
---
name: async-python-patterns
description: "Use when implementing async Python code"
---
# Skill content (max 8KB for Codex)
```

Supporting material:
- `references/` — Detailed docs
- `assets/` — Templates

### Commands (`commands/<n>.md`)

Slash commands:
```yaml
---
description: Scaffold a new Python project
argument-hint: <project-name>
---
# Command instructions
```

## Cross-Harness Adapter Framework

Each adapter transforms source plugins to harness-native artifacts:

| Adapter | Output | Notes |
|---|---|---|
| `codex.py` | `.agents/plugins/marketplace.json` + `plugins/*/.codex-plugin/plugin.json` | 8KB skill cap, TOML agents |
| `cursor.py` | `.cursor-plugin/`, `.cursor/rules/*.mdc` | Thin marketplace + curated rules |
| `opencode.py` | `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/` | Permission blocks, lowercase tools |
| `gemini.py` | `skills/`, `agents/`, `commands/*.toml` | Native skills + subagents |
| `copilot.py` | `.copilot/agents/`, `.copilot/skills/`, `.copilot/commands/` | Markdown profiles + SKILL.md |

## Capability Matrix

| Capability | Claude Code | Codex | Cursor | OpenCode | Gemini | Copilot |
|---|---|---|---|---|---|---|
| Skills native | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Agents native | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Commands native | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ |
| Plugin marketplace | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Parallel agents | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Tool allowlist per agent | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| TodoWrite | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Task spawn | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| MCP servers | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Hooks | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

## Model Tiers

| Tier | Model | Use |
|---|---|---|
| 1 | Opus | Architecture, security, code review, production coding |
| 2 | inherit | Complex tasks — user chooses model |
| 3 | Sonnet | Docs, testing, debugging, support |
| 4 | Haiku | Fast ops, SEO, deployment, simple tasks |

## Quality Gates

1. **`make validate`** — Structural validation of generated artifacts
2. **`make garden`** — Drift detection (dead links, stale artifacts, oversize skills)
3. **`make test`** — Full pytest suite (386 tests)

## Key Files to Copy

### Already Copied
- `plugins/` → `components/plugins/` (86 plugins)
- `tools/adapters/` → `components/tools/adapters/`
- `tools/generate.py` → `components/tools/`
- `tools/install_*.py` → `components/tools/`
- `tools/validate_generated.py` → `components/tools/`
- `docs/` → `components/docs/`
- `AGENTS.md`, `GEMINI.md`, `ARCHITECTURE.md` → `components/templates/`
- `gemini-extension.json` → `components/templates/`

### Need to Copy
- `.claude-plugin/marketplace.json` → `components/templates/`
- `.agents/plugins/marketplace.json` → `components/templates/`
- `.cursor/rules/*.mdc` → `components/templates/cursor/`
- `.cursor-plugin/marketplace.json` → `components/templates/`
- `.gemini/settings.json` → `components/templates/`
- `.github/` → `components/templates/github/`
- `tools/tests/` → `components/tools/tests/`
- `tools/doc_gardener.py` → `components/tools/`
- `tools/check_agent_name_collisions.py` → `components/tools/`

## Statistics

| Category | Count |
|---|---|
| Total plugins | 81 |
| Total agent .md files | 191 |
| Total SKILL.md files | 155 |
| Total command .md files | 102 |
| Plugins with agents | 75 |
| Plugins with skills | 42 |
| Plugins with commands | 51 |
| Plugins with all three | 34 |
| Python adapter files | 7 |
| Test files | 9 |
| Documentation files | 9 |
