> **Note:** This repository contains Anthropic's implementation of skills for Claude. For information about the Agent Skills standard, see [agentskills.io](http://agentskills.io).

# Skills
Skills are folders of instructions, scripts, and resources that Claude loads dynamically to improve performance on specialized tasks. Skills teach Claude how to complete specific tasks in a repeatable way, whether that's creating documents with your company's brand guidelines, analyzing data using your organization's specific workflows, or automating personal tasks.

For more information, check out:
- [What are skills?](https://support.claude.com/en/articles/12512176-what-are-skills)
- [Using skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)
- [How to create custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)
- [Equipping agents for the real world with Agent Skills](https://anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

# About This Repository

This repository contains skills that demonstrate what's possible with Claude's skills system. These skills range from creative applications (art, music, design) to technical tasks (testing web apps, MCP server generation) to enterprise workflows (communications, branding, etc.).

Each skill is self-contained in its own folder with a `SKILL.md` file containing the instructions and metadata that Claude uses. Browse through these skills to get inspiration for your own skills or to understand different patterns and approaches.

Many skills in this repo are open source (Apache 2.0). We've also included the document creation & editing skills that power [Claude's document capabilities](https://www.anthropic.com/news/create-files) under the hood in the [`skills/docx`](./skills/docx), [`skills/pdf`](./skills/pdf), [`skills/pptx`](./skills/pptx), and [`skills/xlsx`](./skills/xlsx) subfolders. These are source-available, not open source, but we wanted to share these with developers as a reference for more complex skills that are actively used in a production AI application.

## Disclaimer

**These skills are provided for demonstration and educational purposes only.** While some of these capabilities may be available in Claude, the implementations and behaviors you receive from Claude may differ from what is shown in these skills. These skills are meant to illustrate patterns and possibilities. Always test skills thoroughly in your own environment before relying on them for critical tasks.

# Skill Sets
- [./skills](./skills): Skill examples for Creative & Design, Development & Technical, Enterprise & Communication, and Document Skills
- [./spec](./spec): The Agent Skills specification
- [./template](./template): Skill template

# Try in Claude Code, Claude.ai, and the API

## Claude Code
You can register this repository as a Claude Code Plugin marketplace by running the following command in Claude Code:
```
/plugin marketplace add anthropics/skills
```

Then, to install a specific set of skills:
1. Select `Browse and install plugins`
2. Select `anthropic-agent-skills`
3. Select `document-skills` or `example-skills`
4. Select `Install now`

Alternatively, directly install either Plugin via:
```
/plugin install document-skills@anthropic-agent-skills
/plugin install example-skills@anthropic-agent-skills
```

After installing the plugin, you can use the skill by just mentioning it. For instance, if you install the `document-skills` plugin from the marketplace, you can ask Claude Code to do something like: "Use the PDF skill to extract the form fields from `path/to/some-file.pdf`"

## Claude.ai

These example skills are all already available to paid plans in Claude.ai. 

To use any skill from this repository or upload custom skills, follow the instructions in [Using skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude#h_a4222fa77b).

## Claude API

You can use Anthropic's pre-built skills, and upload custom skills, via the Claude API. See the [Skills API Quickstart](https://docs.claude.com/en/api/skills-guide#creating-a-skill) for more.

# Creating a Basic Skill

Skills are simple to create - just a folder with a `SKILL.md` file containing YAML frontmatter and instructions. You can use the **template-skill** in this repository as a starting point:

```markdown
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
---

# My Skill Name

[Add your instructions here that Claude will follow when this skill is active]

## Examples
- Example usage 1
- Example usage 2

## Guidelines
- Guideline 1
- Guideline 2
```

The frontmatter requires only two fields:
- `name` - A unique identifier for your skill (lowercase, hyphens for spaces)
- `description` - A complete description of what the skill does and when to use it

The markdown content below contains the instructions, examples, and guidelines that Claude will follow. For more details, see [How to create custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills).

# Partner Skills

Skills are a great way to teach Claude how to get better at using specific pieces of software. As we see awesome example skills from partners, we may highlight some of them here:

- **Notion** - [Notion Skills for Claude](https://www.notion.so/notiondevs/Notion-Skills-for-Claude-28da4445d27180c7af1df7d8615723d0)

# CONTRIBUTORS
[https://github.com/NeerajCodz](https://github.com/NeerajCodz)


# nstack: unified AI coding stack

The `nstack/` CLI manages the repository's portable agents, skills, plugins,
commands, hooks, and MCP manifests across Claude Code, OpenAI Codex, OpenCode,
Oh My Pi, Antigravity CLI, Gemini CLI, Cursor, and GitHub Copilot.

## Quick start

```bash
node nstack/bin/nstack.mjs init --project-home codex
node nstack/bin/nstack.mjs refresh
node nstack/bin/nstack.mjs list available
node nstack/bin/nstack.mjs install mcp/context7
node nstack/bin/nstack.mjs generate codex
```

Use `nstack init --project-home <harness>` when project-local configuration is
preferred. Without `--project-home`, configuration is written to the harness's
normal user directory. Set `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `OPENCLAUDE_CONFIG_DIR`,
`GEMINI_HOME`, `COPILOT_HOME`, `OPENCODE_CONFIG_DIR`, or `PI_CONFIG_DIR` to
override defaults.

Bare `nstack init` creates the shared `AGENTS.md` project workflow template;
it preserves an existing file unchanged. Codex and Antigravity initialization
use the same default when needed. Harness-specific `CLAUDE.md` and `GEMINI.md`
remain separate.

## Component sources and remote folders

The canonical component source is the public
[nstack-directory repository](https://github.com/NeerajCodz/nstack-directory).
The first `install`, `list available`, `init`, or `generate` operation that
needs component files shallow-clones it to `~/.nstack/directory`. `nstack
install type/name` resolves from that checkout; `nstack refresh` updates it
before rebuilding the project registry.

Install a GitHub folder directly with the plural `add` commands:

```bash
nstack plugins add https://github.com/NeerajCodz/nstack-directory/tree/main/plugins/web-scripting
nstack skills add https://github.com/NeerajCodz/nstack-directory/tree/main/skills/security-review
```

Remote folder installation also supports `agents`, `commands`, and `mcps`.
Directory categories include `plugins/`, `skills/`, `agents/`, `commands/`,
`hooks/`, `mcps/`, `templates/`, `catalog/`, `docs/`, and `tools/`. Git must
be installed for directory checkout and remote folder downloads. Review
component instructions, manifests, hooks, and scripts before use; remote
components are untrusted, and nstack does not execute downloaded scripts or
package installers.

## GitHub and Linear workflows

`nstack tools ensure gh` checks GitHub CLI and authentication only when invoked.
It may install `gh` when missing from an official platform package source, but
does not replace an existing installation. Run it immediately before GitHub
issue or pull-request work, then check `gh auth status`; it never automates
login. `gh` uses the official GitHub CLI documentation and release sources.

The first-party `nstack linear` commands use a standalone Convex-backed service
and Next.js consent UI in `apps/web/`. Configure `NSTACK_LINEAR_CONVEX_URL` and
`NSTACK_LINEAR_WEB_URL` for the CLI; configure `NEXT_PUBLIC_CONVEX_URL` and
`NEXT_PUBLIC_SITE_URL` for the web app. Convex deployment secrets are
`LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET`,
`LINEAR_OAUTH_REDIRECT_URI`, and `LINEAR_TOKEN_ENCRYPTION_KEY`. See
[`apps/web/README.md`](apps/web/README.md) for Linear OAuth registration,
deployment setup, and local development. Do not commit `.env.local` or
deployment secrets. `LINEAR_API_KEY` is an optional per-process developer
override; it is not stored in nstack configuration.

Run `nstack linear auth status`, `nstack linear auth login`, and
`nstack linear auth logout` to manage the opaque user-level CLI session.
`nstack linear issue <id> --full --json` reads issue context;
`nstack linear team list --json` discovers teams. See
[`docs/linear-workflow.md`](docs/linear-workflow.md) for safe ticket
interpretation, lifecycle transitions, and uncertain-write handling. Orca is
optional and is used only for Orca-specific operations when its desktop runtime
is reachable.

## Git and GitHub setup

Initialize a repository with the reference Git workflow in one command:

```bash
nstack init git
```

This command:

- runs `git init -b main` when the directory is not already a repository;
- installs `.gitignore`, `.gitattributes`, and a Conventional Commits
  `.gitmessage` template;
- configures `git config commit.template .gitmessage`;
- copies the complete `.github/` reference set, including issue forms,
  pull-request template, workflows, Dependabot, funding, Code of Conduct,
  contributing guidance, and `CODEOWNERS`;
- adds `.github/BRANCHING.md` with feature, fix, docs, test, chore, and release
  branch-name templates.

Existing files are preserved by default, so the command is safe to rerun.
Use `--force` to replace generated files and `--branch <name>` when creating a
new repository with a different initial branch:

```bash
nstack init git --branch develop
nstack init git --force
```

## Curated sources

[`catalog/ai-stack.json`](https://github.com/NeerajCodz/nstack-directory/blob/main/catalog/ai-stack.json) records reviewed entry points and install
commands. It intentionally catalogs sources rather than downloading arbitrary
code. The main sources are:

- [Anthropic skills](https://github.com/anthropics/skills)
- [OpenAI Codex skills](https://github.com/openai/skills)
- [OpenAI plugins](https://github.com/openai/plugins)
- [Vercel agent skills](https://github.com/vercel-labs/agent-skills)
- [obra/superpowers](https://github.com/obra/superpowers)
- [MCP official registry](https://registry.modelcontextprotocol.io)
- [Model Context Protocol specification](https://modelcontextprotocol.io)


For portable plugin authoring conventions, see [the directory repository's authoring guide](https://github.com/NeerajCodz/nstack-directory/blob/main/docs/authoring.md).
## MCP policy

MCP manifests are explicit and portable; adapters translate them into each
harness's native format. Prefer official repositories, pin versions before
production use, keep credentials in environment variables, and install only
the servers required for the current project. `nstack` does not execute remote
package installers as a side effect of listing or generating artifacts.

Bundled manifests:

- `context7` — versioned library documentation
- `playwright` — browser automation and web app inspection
- `chrome-devtools` — Chrome inspection and performance debugging
- `github` — repositories, issues, pull requests, and Actions

## Portability contract

Keep behavioral instructions in `AGENTS.md`; harness-specific files
(`CLAUDE.md`, `GEMINI.md`, and generated settings) should adapt that contract
instead of defining conflicting rules. Install only the plugin and skill
surfaces supported by the target harness; nstack's adapters omit unsupported
surfaces rather than silently changing semantics.