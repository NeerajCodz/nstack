import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix as posixPath, win32 as win32Path } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const PRIORITIES = Object.freeze({ none: 0, urgent: 1, high: 2, medium: 3, low: 4 });
const LIMIT_FLAGS = new Set(["comments", "children", "attachments", "relations", "activity", "full", "current", "include-archived", "parent-current", "me", "json"]);
const ARRAY_FLAGS = new Set(["label"]);
const KNOWN_VALUE_FLAGS = new Set([
  "depth", "workspace", "limit", "filter", "team", "query", "cursor", "order-by", "cycle", "state", "project", "release", "assignee", "delegate", "parent-id", "priority", "created-at", "updated-at", "title", "description", "body", "body-file", "to", "to-id", "estimate", "due-date", "label", "write-id", "parent", "related", "type", "reply-to", "url"
]);
const SAFE_WRITE_OPS = new Set([
  "issue.save", "issue.create", "relation.add", "relation.remove", "status.set", "assignee.set", "assignee.clear", "priority.set", "priority.clear", "estimate.set", "estimate.clear", "dueDate.set", "dueDate.clear", "label.add", "label.remove", "label.set", "comment.add", "attachment.add"
]);
export const LINEAR_HELP = `nstack linear — Linear issues, teams, and projects

Usage:
  nstack linear auth login|status|logout
  nstack linear issue <id> [--comments] [--children] [--full] [--depth 0..5]
  nstack linear search <query> [--limit 1..50] [--cursor <cursor> --workspace <id>]
  nstack linear list [--filter assigned|created|all|completed|open] [--team <selector>] [--limit N] [--cursor <cursor> --workspace <id>]
  nstack linear list-issues [filters] [--limit N] [--cursor <cursor> --workspace <id>]
  nstack linear team list|members|states|labels [--team <selector>] [--cursor <cursor> --workspace <id>]
  nstack linear project list [--query <text>] [--limit N] [--cursor <cursor> --workspace <id>]
  nstack linear create --title <text> [--team <selector>] [--body|--body-file <path>]
  nstack linear save-issue [<id>|--current] [issue fields]
  nstack linear status|assignee|priority|estimate|due-date set|clear <id> [field options]
  nstack linear label add|remove|set <id> --label <name>...
  nstack linear relation add|remove <id> --related <id> --type <blocks|blocked-by|related|duplicate-of>
  nstack linear comment add <id> --body|--body-file <text|path>
  nstack linear attach <id> --url <https-url> [--title <text>]

Options:
  --workspace <id>  Select the connected workspace; cursors require a concrete workspace.
  --current          Resolve the current issue only through an explicitly requested Orca context.
  --write-id <uuid>  Supply a stable ID before a write if retry deduplication is required.
  --json             Emit machine-readable JSON.

All Linear API calls pass through the configured Convex service. LINEAR_API_KEY is an explicit per-process override; otherwise use the OAuth session from auth login.
`;

export class LinearError extends Error {
  constructor(code, message, data = undefined, status = 1) {
    super(message);
    this.name = "LinearError";
    this.code = code.startsWith("linear_") ? code : `linear_${code}`;
    this.data = data;
    this.status = status;
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.data === undefined ? {} : { data: this.data }) };
  }
}

function fail(code, message, data) {
  throw new LinearError(code, message, data);
}

export function linearCredentialPath({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  const path = platform === "win32" ? win32Path : posixPath;
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "nstack", "linear.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "nstack", "linear.json");
}

function readSession(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed.sessionToken !== "string" || !parsed.sessionToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(filePath, session, platform = process.platform) {
  const path = platform === "win32" ? win32Path : posixPath;
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (platform !== "win32") chmodSync(directory, 0o700);
  writeFileSync(filePath, `${JSON.stringify(session, null, 2)}\n`, { mode: platform === "win32" ? undefined : 0o600 });
  if (platform !== "win32") chmodSync(filePath, 0o600);
}

function parseArgs(argv) {
  const flags = Object.create(null);
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const at = token.indexOf("=");
    const name = token.slice(2, at === -1 ? undefined : at);
    if (!KNOWN_VALUE_FLAGS.has(name) && !LIMIT_FLAGS.has(name)) fail("invalid_argument", `Unknown option --${name}`);
    let value = at === -1 ? undefined : token.slice(at + 1);
    if (LIMIT_FLAGS.has(name)) {
      if (value !== undefined) fail("invalid_argument", `Option --${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) fail("invalid_argument", `Option --${name} requires a value`);
      i += 1;
    }
    if (ARRAY_FLAGS.has(name)) (flags[name] ??= []).push(value);
    else flags[name] = value;
  }
  return { flags, positional };
}

const ROOT_COMMANDS = new Set(["issue", "search", "list", "list-issues", "save-issue", "create", "attach"]);
function splitCommand(positional) {
  const length = ROOT_COMMANDS.has(positional[0]) ? 1
    : ["team", "project", "relation", "status", "assignee", "priority", "estimate", "due-date", "label", "comment"].includes(positional[0]) ? 2
      : 0;
  if (!length || positional.length < length) fail("invalid_argument", `Unknown Linear command: ${positional.join(" ") || "(empty)"}`);
  return { command: positional.slice(0, length), operands: positional.slice(length) };
}

function validateCommandFlags(command, flags) {
  const key = command.join(" ");
  const sets = {
    issue: ["current", "comments", "children", "depth", "attachments", "relations", "activity", "full", "workspace"],
    search: ["limit", "cursor", "workspace", "query"],
    list: ["filter", "team", "limit", "cursor", "workspace"],
    "list-issues": ["team", "cycle", "label", "limit", "query", "state", "cursor", "order-by", "project", "release", "assignee", "delegate", "parent-id", "priority", "created-at", "updated-at", "include-archived", "workspace"],
    "team list": ["cursor", "workspace"],
    "team members": ["team", "cursor", "workspace"], "team states": ["team", "cursor", "workspace"], "team labels": ["team", "cursor", "workspace"],
    "project list": ["query", "limit", "cursor", "workspace"],
    "save-issue": ["current", "team", "title", "description", "body-file", "state", "assignee", "priority", "estimate", "due-date", "label", "project", "parent-id", "write-id", "workspace"],
    create: ["title", "body", "body-file", "team", "project", "state", "assignee", "priority", "estimate", "due-date", "label", "parent", "parent-current", "write-id", "workspace"],
    "relation add": ["current", "related", "type", "workspace"], "relation remove": ["current", "related", "type", "workspace"], "relation rm": ["current", "related", "type", "workspace"],
    "status set": ["current", "to", "workspace"],
    "assignee set": ["current", "me", "to-id", "workspace"], "assignee clear": ["current", "workspace"],
    "priority set": ["current", "to", "workspace"], "priority clear": ["current", "workspace"],
    "estimate set": ["current", "to", "workspace"], "estimate clear": ["current", "workspace"],
    "due-date set": ["current", "to", "workspace"], "due-date clear": ["current", "workspace"],
    "label add": ["current", "label", "workspace"], "label remove": ["current", "label", "workspace"], "label set": ["current", "label", "workspace"],
    "comment add": ["current", "body", "body-file", "reply-to", "write-id", "workspace"],
    attach: ["current", "url", "title", "write-id", "workspace"],
  };
  const allowed = new Set([...(sets[key] ?? []), "json"]);
  for (const name of Object.keys(flags)) if (!allowed.has(name)) fail("invalid_argument", `Option --${name} is not supported by ${key}`);
}

function required(flags, name, label = name) {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "") fail("invalid_argument", `--${name} is required (${label})`);
  return value;
}

function noWorkspaceAll(flags, subject = "This operation") {
  if (flags.workspace === "all") fail("invalid_workspace", `${subject} requires one workspace; --workspace all is not allowed`);
}

function issueTarget(flags, positional, purpose = "This command") {
  const id = positional[0];
  if (id && flags.current) fail("invalid_argument", "Pass either an issue id or --current, not both");
  if (!id && !flags.current) fail("issue_required", `${purpose} requires an issue id or --current`);
  noWorkspaceAll(flags, "Issue lookup or write");
  return { id, current: Boolean(flags.current) };
}

function positiveNumber(value, name, { min = 1, max = Infinity, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (value === undefined) fail("invalid_argument", `--${name} is required`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail("invalid_argument", `--${name} must be an integer from ${min} to ${max === Infinity ? "infinity" : max}`);
  return number;
}

function clampedInteger(value, name, fallback, min, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number)) fail("invalid_argument", `--${name} must be an integer`);
  return Math.min(max, Math.max(min, number));
}

function uuid(value) {
  if (value !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail("invalid_argument", "--write-id must be a UUID");
  return value;
}

function realDate(value, name, { nullable = false } = {}) {
  if (value === undefined) return undefined;
  if (value === "null") {
    if (nullable) return null;
    fail("invalid_argument", `--${name} must be a real YYYY-MM-DD date`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("invalid_argument", `--${name} must be YYYY-MM-DD${nullable ? " or null" : ""}`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail("invalid_argument", `--${name} must be a real calendar date`);
  return value;
}

function priority(value, name = "priority") {
  if (value === undefined) return undefined;
  if (!Object.hasOwn(PRIORITIES, value)) fail("invalid_priority", `--${name} must be none, low, medium, high, or urgent`);
  return PRIORITIES[value];
}

function checkBody(value, max, kind) {
  if (value.length > max) fail("body_too_large", `${kind} must be at most ${max.toLocaleString("en-US")} characters`, { limit: max, length: value.length });
  return value;
}

async function readBody(flags, { allowDescription = false, max = 65000, kind = "Body", stdin = process.stdin } = {}) {
  const inlineName = allowDescription && flags.description !== undefined ? "description" : "body";
  const inlinePresent = flags[inlineName] !== undefined;
  const filePresent = flags["body-file"] !== undefined;
  if (inlinePresent && filePresent) fail("invalid_argument", `--${inlineName} and --body-file are mutually exclusive`);
  if (allowDescription && flags.body !== undefined) fail("invalid_argument", "Use --description (not --body) with this command");
  if (flags.description !== undefined && flags.body !== undefined) fail("invalid_argument", "--description and --body are mutually exclusive");
  if (inlinePresent) return checkBody(flags[inlineName], max, kind);
  if (!filePresent) return undefined;
  if (flags["body-file"] === "-") {
    if (stdin.isTTY) fail("invalid_argument", "--body-file - requires stdin to be piped");
    let body = "";
    if (typeof stdin === "string") body = stdin;
    else if (stdin && typeof stdin[Symbol.asyncIterator] === "function") {
      for await (const chunk of stdin) {
        body += chunk.toString();
        if (body.length > max) fail("body_too_large", `${kind} must be at most ${max.toLocaleString("en-US")} characters`, { limit: max, length: body.length });
      }
    } else if (typeof stdin?.read === "function") {
      const chunks = [];
      for (let chunk; (chunk = stdin.read()) !== null;) chunks.push(chunk.toString());
      body = chunks.join("");
    } else fail("invalid_argument", "Cannot read piped stdin");
    return checkBody(body, max, kind);
  }
  try {
    return checkBody(readFileSync(flags["body-file"], "utf8"), max, kind);
  } catch (error) {
    if (error instanceof LinearError) throw error;
    fail("invalid_argument", `Cannot read body file: ${flags["body-file"]}`, { cause: error.message });
  }
}

function normalizeIssueId(input) {
  if (!input) return input;
  const match = String(input).match(/(?:^|\/issue\/)([A-Za-z][A-Za-z0-9]*-\d+)(?:\/|$)/i);
  return match ? match[1] : input;
}

function validateDurationOrDate(value, name) {
  if (value === undefined) return;
  const dateTime = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (dateTime) {
    realDate(dateTime[1], name);
    if (!Number.isNaN(new Date(value).getTime())) return;
  }
  if (/^-?P(?=\d|T\d)(?:\d+(?:\.\d+)?Y)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?W)?(?:\d+(?:\.\d+)?D)?(?:T(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$/.test(value)) return;
  fail("invalid_argument", `--${name} must be a datetime or ISO-8601 duration`);
}

function commandData(command, flags, positional, body) {
  const workspace = flags.workspace;
  const writeId = uuid(flags["write-id"]);
  if (command[0] === "issue" && command.length === 1) {
    const id = positional[0] ? normalizeIssueId(positional[0]) : undefined;
    if (!id && !flags.current) fail("issue_required", "Pass an issue id or --current");
    if (id && flags.current) fail("invalid_argument", "Pass either an issue id or --current, not both");
    noWorkspaceAll(flags, "Issue lookup");
    const include = Boolean(flags.full);
    const depth = flags.depth === undefined ? (flags.children || include ? 2 : undefined) : clampedInteger(flags.depth, "depth", 2, 0, 5);
    if (flags.depth !== undefined && !flags.children && !include) fail("invalid_argument", "--depth requires --children or --full");
    return { operation: "issue.get", args: { id, current: Boolean(flags.current), workspace, comments: Boolean(flags.comments || include), children: Boolean(flags.children || include), depth, attachments: Boolean(flags.attachments || include), relations: Boolean(flags.relations || include), activity: Boolean(flags.activity || include), full: include } };
  }
  if (command[0] === "search" && command.length === 1) {
    const query = positional.join(" ").trim() || required(flags, "query");
    if (flags.cursor !== undefined && (!workspace || workspace === "all")) fail("invalid_workspace", "--cursor requires a concrete --workspace because cursors are workspace-bound");
    return { operation: "issue.search", args: Object.fromEntries(Object.entries({ query, limit: clampedInteger(flags.limit, "limit", 20, 1, 50), cursor: flags.cursor, workspace }).filter(([, value]) => value !== undefined)) };
  }
  if (command[0] === "list" && command.length === 1) {
    const filter = flags.filter ?? "assigned";
    if (!["assigned", "created", "all", "completed", "open"].includes(filter)) fail("invalid_argument", "--filter must be assigned, created, all, completed, or open");
    if (flags.cursor !== undefined && (!workspace || workspace === "all")) fail("invalid_workspace", "--cursor requires a concrete --workspace because cursors are workspace-bound");
    return { operation: "issue.list", args: Object.fromEntries(Object.entries({ filter, team: flags.team, limit: positiveNumber(flags.limit, "limit", { min: 1, optional: true }), cursor: flags.cursor, workspace }).filter(([, value]) => value !== undefined)) };
  }
  if (command[0] === "list-issues" && command.length === 1) {
    const fields = {
      team: flags.team, cycle: flags.cycle, label: flags.label?.length > 1 ? fail("invalid_argument", "list-issues accepts one --label filter") : flags.label?.[0],
      limit: positiveNumber(flags.limit, "limit", { min: 1, optional: true }), query: flags.query,
      state: flags.state, cursor: flags.cursor, orderBy: flags["order-by"], project: flags.project, release: flags.release,
      assignee: flags.assignee, delegate: flags.delegate, parentId: flags["parent-id"],
      priority: flags.priority === undefined ? undefined : Number(flags.priority), createdAt: flags["created-at"], updatedAt: flags["updated-at"],
      includeArchived: Boolean(flags["include-archived"]), workspace,
    };
    if (fields.orderBy !== undefined && !["createdAt", "updatedAt"].includes(fields.orderBy)) fail("invalid_argument", "--order-by must be createdAt or updatedAt");
    if (fields.priority !== undefined && (!Number.isInteger(fields.priority) || fields.priority < 0 || fields.priority > 4)) fail("invalid_priority", "--priority must be an integer from 0 to 4");
    for (const key of ["assignee", "delegate", "parentId"]) if (fields[key] === "null") fields[key] = null;
    for (const key of ["createdAt", "updatedAt"]) validateDurationOrDate(fields[key], key === "createdAt" ? "created-at" : "updated-at");
    if (fields.cursor !== undefined && (!workspace || workspace === "all")) fail("invalid_workspace", "--cursor requires a concrete --workspace because cursors are workspace-bound");
    return { operation: "issue.listIssues", args: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) };
  }
  if (command[0] === "team" && command[1] === "list" && command.length === 2) {
    if (flags.cursor !== undefined && (!workspace || workspace === "all")) fail("invalid_workspace", "--cursor requires a concrete --workspace because cursors are workspace-bound");
    return { operation: "team.list", args: Object.fromEntries(Object.entries({ cursor: flags.cursor, workspace }).filter(([, value]) => value !== undefined)) };
  }
  if (command[0] === "team" && ["members", "states", "labels"].includes(command[1]) && command.length === 2) {
    if (flags.cursor !== undefined && (!workspace || workspace === "all")) fail("invalid_workspace", "--cursor requires a concrete --workspace because cursors are workspace-bound");
    return { operation: `team.${command[1]}`, args: Object.fromEntries(Object.entries({ team: required(flags, "team"), cursor: flags.cursor, workspace }).filter(([, value]) => value !== undefined)) };
  }
  if (command[0] === "project" && command[1] === "list" && command.length === 2) {
    if (flags.cursor !== undefined && (!workspace || workspace === "all")) fail("invalid_workspace", "--cursor requires a concrete --workspace because cursors are workspace-bound");
    return { operation: "project.list", args: Object.fromEntries(Object.entries({ query: flags.query, limit: positiveNumber(flags.limit, "limit", { min: 1, optional: true }), cursor: flags.cursor, workspace }).filter(([, value]) => value !== undefined)) };
  }
  if (command[0] === "save-issue" && command.length === 1) {
    const id = positional[0] ? normalizeIssueId(positional[0]) : undefined;
    if (id && flags.current) fail("invalid_argument", "Pass either an issue id or --current, not both");
    if (!id && !flags.current && !flags.title) fail("invalid_argument", "Creating an issue with save-issue requires --title");
    noWorkspaceAll(flags, "Issue writes");
    const args = { id, current: Boolean(flags.current), team: flags.team, title: flags.title, description: body ?? flags.description, state: flags.state, assignee: flags.assignee === "null" ? null : flags.assignee, priority: priority(flags.priority), estimate: flags.estimate === "null" ? null : positiveNumber(flags.estimate, "estimate", { min: 0, optional: true }), dueDate: realDate(flags["due-date"], "due-date", { nullable: true }), labels: flags.label, project: flags.project === "null" ? null : flags.project, parentId: flags["parent-id"] === "null" ? null : normalizeIssueId(flags["parent-id"]), writeId, workspace };
    if (args.description !== undefined) checkBody(args.description, 65000, "Issue description");
    const operation = id || flags.current ? "issue.save" : "issue.create";
    if (operation === "issue.create") {
      delete args.id;
      delete args.current;
    }
    return { operation, args: Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) };
  }
  if (command[0] === "create" && command.length === 1) {
    noWorkspaceAll(flags, "Issue creation");
    const title = required(flags, "title");
    if (flags.parent && flags["parent-current"]) fail("invalid_argument", "--parent and --parent-current are mutually exclusive");
    const args = { title, description: body, team: flags.team, project: flags.project === "null" ? null : flags.project, state: flags.state, assignee: flags.assignee === "null" ? null : flags.assignee, priority: priority(flags.priority), estimate: flags.estimate === "null" ? null : positiveNumber(flags.estimate, "estimate", { min: 0, optional: true }), dueDate: realDate(flags["due-date"], "due-date", { nullable: true }), labels: flags.label, parentId: flags.parent === "null" ? null : normalizeIssueId(flags.parent), parentCurrent: Boolean(flags["parent-current"]), writeId, workspace };
    if (args.description !== undefined) checkBody(args.description, 65000, "Issue description");
    return { operation: "issue.create", args: Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) };
  }
  if (command[0] === "relation" && ["add", "remove", "rm"].includes(command[1]) && command.length === 2) {
    const target = issueTarget(flags, positional, "Relation changes");
    const type = required(flags, "type");
    if (!["blocks", "blocked-by", "related", "duplicate-of"].includes(type)) fail("invalid_argument", "--type must be blocks, blocked-by, related, or duplicate-of");
    return { operation: `relation.${command[1] === "add" ? "add" : "remove"}`, args: { ...target, id: target.id ? normalizeIssueId(target.id) : undefined, related: normalizeIssueId(required(flags, "related")), type, workspace } };
  }
  if (["status", "assignee", "priority", "estimate", "due-date", "label"].includes(command[0])) {
    const field = command[0];
    const action = command[1];
    if (!command[1] || command.length !== 2) fail("invalid_argument", `Unknown ${field} command`);
    const target = issueTarget(flags, positional, `${field} changes`);
    const common = { ...target, id: target.id ? normalizeIssueId(target.id) : undefined, workspace };
    if (field === "status" && action === "set") return { operation: "status.set", args: { ...common, to: required(flags, "to") } };
    if (field === "assignee" && action === "set") {
      if (Boolean(flags.me) === (flags["to-id"] !== undefined)) fail("invalid_argument", "Use exactly one of --me or --to-id");
      return { operation: "assignee.set", args: { ...common, to: flags.me ? "me" : required(flags, "to-id") } };
    }
    if (field === "priority" && action === "set") return { operation: "priority.set", args: { ...common, to: required(flags, "to") } };
    if (field === "estimate" && action === "set") return { operation: "estimate.set", args: { ...common, to: required(flags, "to") } };
    if (field === "due-date" && action === "set") return { operation: "dueDate.set", args: { ...common, to: realDate(required(flags, "to"), "to") } };
    if (field === "label" && ["add", "remove", "set"].includes(action)) return { operation: `label.${action}`, args: { ...common, labels: flags.label?.length ? flags.label : fail("invalid_argument", "At least one --label is required") } };
    if (["assignee", "priority", "estimate", "due-date"].includes(field) && action === "clear") return { operation: `${field === "due-date" ? "dueDate" : field}.${action}`, args: common };
    fail("invalid_argument", `Unknown ${field} command: ${action}`);
  }
  if (command[0] === "comment" && command[1] === "add" && command.length === 2) {
    const target = issueTarget(flags, positional, "Comment creation");
    if (body === undefined) fail("invalid_argument", "comment add requires --body or --body-file");
    const replyTo = flags["reply-to"] ? normalizeIssueId(flags["reply-to"]) : undefined;
    return { operation: "comment.add", args: { ...target, id: target.id ? normalizeIssueId(target.id) : undefined, body: checkBody(body, 20000, "Comment body"), replyTo, writeId, workspace } };
  }
  if (command[0] === "attach" && command.length === 1) {
    const target = issueTarget(flags, positional, "Attachment creation");
    const url = required(flags, "url");
    let parsed;
    try { parsed = new URL(url); } catch { fail("invalid_argument", "--url must be an absolute HTTP(S) URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) fail("invalid_argument", "--url must be an absolute HTTP(S) URL");
    return { operation: "attachment.add", args: { ...target, id: target.id ? normalizeIssueId(target.id) : undefined, url: parsed.href, title: flags.title, writeId, workspace } };
  }
  fail("invalid_argument", `Unknown Linear command: ${command.join(" ") || "(empty)"}`);
}

function findExecutable(name, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const path = platform === "win32" ? win32Path : posixPath;
  const pathSeparator = platform === "win32" ? ";" : ":";
  const suffixes = platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH || "").split(pathSeparator)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(dir, `${name}${suffix}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function defaultRunner(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function hasRuntimeReadySignal(value) {
  if (typeof value === "string") return /^(reachable|connected|available|running|ready|online)$/i.test(value);
  if (!value || typeof value !== "object") return false;
  const positiveKeys = /^(reachable|connected|available|running|ready|online)$/i;
  for (const [key, child] of Object.entries(value)) {
    if (positiveKeys.test(key) && child === true) return true;
    if (/^(status|state)$/i.test(key) && typeof child === "string" && hasRuntimeReadySignal(child)) return true;
    if (child && typeof child === "object" && hasRuntimeReadySignal(child)) return true;
  }
  return false;
}

function reachableRuntime(value) {
  if (!value || typeof value !== "object") return false;
  if (value.runtimeReachable === true || value.desktopRuntimeReachable === true) return true;
  const containers = [value.runtime, value.desktopRuntime, value.desktop, value.status?.runtime, value.status?.desktopRuntime];
  return containers.some(hasRuntimeReadySignal);
}

function parseOrcaIssue(output) {
  let parsed;
  try { parsed = JSON.parse(output); } catch { fail("issue_required", "Orca did not return valid JSON for the current issue"); }
  const root = parsed.issue ?? parsed.data?.issue ?? parsed.data ?? parsed;
  const id = root.id ?? root.identifier ?? root.issue?.id ?? root.issue?.identifier;
  const workspace = root.workspaceId ?? root.workspace?.id ?? root.team?.organization?.id;
  if (typeof id !== "string" || !id) fail("issue_required", "Orca has no linked current Linear issue; pass an explicit issue id");
  return { id: normalizeIssueId(id), workspace, response: parsed };
}

function currentOrca({ runner, lookupExecutable, platform, env }) {
  if (!lookupExecutable("orca", { platform, env })) fail("issue_required", "--current requires the Orca CLI and a reachable Orca desktop runtime; pass an explicit issue id");
  let status;
  try { status = runner("orca", ["status", "--json"]); } catch { fail("issue_required", "--current requires a reachable Orca desktop runtime; pass an explicit issue id"); }
  let statusData;
  try { statusData = JSON.parse(status); } catch { statusData = null; }
  if (!reachableRuntime(statusData)) fail("issue_required", "--current requires a reachable Orca desktop runtime; pass an explicit issue id");
  let output;
  try { output = runner("orca", ["linear", "issue", "--current", "--full", "--json"]); }
  catch { fail("issue_required", "Orca could not resolve a linked current Linear issue; pass an explicit issue id"); }
  return parseOrcaIssue(output);
}

function endpoint(base, route) {
  if (!base) fail("config_missing", "Set NSTACK_LINEAR_CONVEX_URL to your Convex HTTP URL before using Linear");
  let url;
  try { url = new URL(base); } catch { fail("config_missing", "NSTACK_LINEAR_CONVEX_URL must be an absolute HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol)) fail("config_missing", "NSTACK_LINEAR_CONVEX_URL must be an absolute HTTP(S) URL");
  return new URL(route.replace(/^\//, ""), `${url.href.replace(/\/$/, "")}/`).href;
}

function asPayload(value) {
  if (value && typeof value.json === "function") return value.json();
  return value;
}

function mapErrorCode(body, status) {
  const raw = body?.error?.code ?? body?.code ?? body?.error ?? "";
  if (typeof raw === "string" && raw.startsWith("linear_")) return raw;
  if (status === 401 || status === 403) return "linear_permission_denied";
  if (status === 408 || status === 504) return "linear_timeout";
  if (status === 429) return "linear_rate_limited";
  if (status >= 500) return "linear_network";
  const mappings = {
    unauthenticated: "linear_not_connected", not_connected: "linear_not_connected",
    auth_expired: "linear_auth_expired", "auth-expired": "linear_auth_expired",
    invalid_workspace: "linear_invalid_workspace", "invalid-workspace": "linear_invalid_workspace",
    invalid_state: "linear_invalid_state", "invalid-state": "linear_invalid_state",
    invalid_assignee: "linear_invalid_assignee", "invalid-assignee": "linear_invalid_assignee",
    invalid_label: "linear_invalid_label", "invalid-label": "linear_invalid_label",
    invalid_project: "linear_invalid_project", "invalid-project": "linear_invalid_project",
    invalid_parent: "linear_invalid_parent", "invalid-parent": "linear_invalid_parent",
    write_unconfirmed: "linear_write_unconfirmed", "write-unconfirmed": "linear_write_unconfirmed",
    rate_limited: "linear_rate_limited", "rate-limited": "linear_rate_limited",
    permission_denied: "linear_permission_denied", "permission-denied": "linear_permission_denied",
    issue_required: "linear_issue_required", "issue-required": "linear_issue_required",
    not_found: "linear_issue_required", timeout: "linear_timeout", network: "linear_network",
    partial_result: "linear_partial_result", invalid_priority: "linear_invalid_priority",
    invalid_argument: "linear_invalid_argument", body_too_large: "linear_body_too_large",
  };
  return mappings[String(raw).toLowerCase()] ?? "linear_network";
}

async function post(route, body, deps) {
  const url = endpoint(deps.env.NSTACK_LINEAR_CONVEX_URL, route);
  try {
    let response;
    if (deps.transport) {
      response = await deps.transport({ url, route, body, method: "POST" });
    } else {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      deps.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 30000);
      try {
        response = await deps.fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      } finally {
        clearTimeout(timer);
        deps.signal?.removeEventListener("abort", onAbort);
      }
    }
    const payload = await asPayload(response);
    const status = Number.isInteger(response?.status) ? response.status : 200;
    const ok = typeof response?.ok === "boolean" ? response.ok : status >= 200 && status < 300;
    if (!ok || payload?.error) {
      const code = mapErrorCode(payload, status);
      const err = payload?.error;
      throw new LinearError(code, err?.message ?? payload?.message ?? `Linear service request failed (${status})`, err?.data ?? payload?.data, status);
    }
    return payload;
  } catch (error) {
    if (error instanceof LinearError) throw error;
    if (deps.signal?.aborted) throw new LinearError("linear_cancelled", "Linear request was cancelled");
    if (error?.name === "AbortError" || error?.code === "ETIMEDOUT") throw new LinearError("linear_timeout", "Linear service request timed out");
    throw new LinearError("linear_network", "Could not reach the nstack Linear service", { reason: error?.message });
  }
}

async function callLinear(operation, args, deps, session, { retryWrite = true } = {}) {
  const body = { operation, args };
  if (deps.env.LINEAR_API_KEY) body.apiKey = deps.env.LINEAR_API_KEY;
  else if (session?.sessionToken) body.sessionToken = session.sessionToken;
  else throw new LinearError("linear_not_connected", "Linear is not connected. Run `nstack linear auth login` or set LINEAR_API_KEY.");
  try {
    const payload = await post("/linear/cli/request", body, deps);
    return payload?.data ?? payload;
  } catch (error) {
    if (error.code === "linear_write_unconfirmed" && retryWrite && body.args.writeId && error.data?.writeId === body.args.writeId) {
      // A matching write ID is the backend's idempotency key: replay exactly the same body once.
      const replay = await post("/linear/cli/request", body, deps);
      return replay?.data ?? replay;
    }
    throw error;
  }
}

function authCredential(env, path, now) {
  if (env.LINEAR_API_KEY) return { mode: "api-key" };
  const session = readSession(path);
  if (!session) return { mode: "not-connected" };
  if (session.expiresAt && Date.parse(session.expiresAt) <= now()) return { mode: "expired", session };
  return { mode: "session", session };
}

async function defaultOpenBrowser(url, platform = process.platform) {
  if (platform === "win32") execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true });
  else if (platform === "darwin") execFileSync("open", [url], { stdio: "ignore" });
  else execFileSync("xdg-open", [url], { stdio: "ignore" });
}
function webUrl(base, requestId) {
  if (!base) fail("config_missing", "Set NSTACK_LINEAR_WEB_URL to the nstack Linear web application URL before logging in");
  let parsed;
  try { parsed = new URL(base); } catch { fail("config_missing", "NSTACK_LINEAR_WEB_URL must be an absolute HTTP(S) URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) fail("config_missing", "NSTACK_LINEAR_WEB_URL must be an absolute HTTP(S) URL");
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/linear/connect`;
  parsed.search = "";
  parsed.hash = "";
  parsed.searchParams.set("requestId", requestId);
  return parsed.href;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LinearError("cancelled", "Linear login was cancelled"));
      return;
    }
    let timer;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, new LinearError("cancelled", "Linear login was cancelled"));
    timer = setTimeout(() => finish(resolve), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function login(deps) {
  const secret = randomBytes(32).toString("base64url");
  const pollSecretHash = createHash("sha256").update(secret).digest("hex");
  const connectUrl = webUrl(deps.env.NSTACK_LINEAR_WEB_URL, "pending");
  const begun = await post("/linear/cli/auth/begin", { pollSecretHash }, deps);
  const data = begun?.data ?? begun;
  if (!data?.requestId || !data?.expiresAt) fail("network", "Linear auth service returned an invalid login request");
  const url = new URL(connectUrl);
  url.searchParams.set("requestId", data.requestId);
  const loginUrl = url.href;
  try { await deps.openBrowser(loginUrl); }
  catch (error) { throw new LinearError("network", "Could not open a browser. Open this URL to continue Linear login.", { authorizationUrl: loginUrl, reason: error.message }); }
  const deadline = Date.parse(data.expiresAt);
  while (deps.now() < deadline) {
    if (deps.signal?.aborted) fail("cancelled", "Linear login was cancelled");
    const polled = await post("/linear/cli/auth/poll", { requestId: data.requestId, pollSecret: secret }, deps);
    const result = polled?.data ?? polled;
    if (result?.status === "complete") {
      if (!result.sessionToken || !result.expiresAt) fail("network", "Linear auth service returned an incomplete CLI session");
      saveSession(deps.credentialPath, { sessionToken: result.sessionToken, expiresAt: result.expiresAt }, deps.platform);
      return { status: "connected", expiresAt: result.expiresAt };
    }
    if (result?.status !== "pending") fail("permission_denied", result?.message ?? "Linear authorization was denied or expired");
    await deps.sleep(Math.min(1500, Math.max(0, deadline - deps.now())), deps.signal);
  }
  fail("auth_expired", "Linear login request expired before approval; run `nstack linear auth login` again");
}

async function authCommand(args, deps) {
  const action = args[0];
  if (!action || args.length > 1 || !["login", "status", "logout"].includes(action)) fail("invalid_argument", "Usage: nstack linear auth login|status|logout");
  if (action === "login") return login(deps);
  if (action === "status") {
    const credential = authCredential(deps.env, deps.credentialPath, deps.now);
    return credential.mode === "api-key" ? { status: "connected", method: "api-key" }
      : credential.mode === "session" ? { status: "connected", method: "session", expiresAt: credential.session.expiresAt }
        : { status: credential.mode };
  }
  const session = readSession(deps.credentialPath);
  let revoked = false;
  if (session?.sessionToken) {
    const response = await post("/linear/cli/auth/revoke", { sessionToken: session.sessionToken }, deps);
    revoked = (response?.data ?? response)?.revoked === true;
  }
  try { if (existsSync(deps.credentialPath)) unlinkSync(deps.credentialPath); } catch { /* revocation succeeded remotely; local cleanup is best effort */ }
  return { revoked };
}

function normalizeResponse(data, operation, args) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const result = { ...data };
    if (["issue.search", "issue.list", "issue.listIssues", "project.list"].includes(operation)) {
      const meta = { ...(result.meta ?? {}) };
      if (meta.limit === undefined) meta.limit = args.limit ?? null;
      if (meta.hasMore === undefined) meta.hasMore = Boolean(result.hasMore ?? result.truncated ?? false);
      if (meta.nextCursor === undefined && result.nextCursor !== undefined) meta.nextCursor = result.nextCursor;
      result.meta = meta;
    }
    if (operation === "issue.get") {
      const meta = { ...(result.meta ?? {}) };
      if (result.partial === true && !meta.partial) meta.partial = true;
      if (result.sectionCaps && !meta.sectionCaps) meta.sectionCaps = result.sectionCaps;
      if (Object.keys(meta).length) result.meta = meta;
    }
    return result;
  }
  return data;
}

function human(data) {
  if (data === undefined || data === null) return "Done.";
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
  const items = data.issues ?? data.teams ?? data.projects ?? data.members ?? data.states ?? data.labels ?? data.results;
  if (Array.isArray(items)) {
    const lines = items.map((item) => {
      if (typeof item === "string") return `- ${item}`;
      const id = item.identifier ?? item.key ?? item.id ?? "";
      const title = item.title ?? item.name ?? item.email ?? "";
      const state = item.state?.name ?? item.status ?? "";
      return `- ${[id, title, state].filter(Boolean).join(" — ")}`;
    });
    const meta = data.meta ?? {};
    if (data.truncated || meta.hasMore) lines.push(`truncated: showing ${items.length}`);
    if (meta.nextCursor) lines.push(`next cursor: ${meta.nextCursor}`);
    return lines.join("\n") || "No results.";
  }
  return JSON.stringify(data, null, 2);
}

function dependencyDefaults(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const credentialPath = options.credentialPath ?? linearCredentialPath({ platform, env, home: options.home ?? homedir() });
  return {
    env, platform, credentialPath, now: options.now ?? Date.now,
    fetchImpl: options.fetchImpl ?? fetch,
    transport: options.transport,
    runner: options.runner ?? defaultRunner,
    lookupExecutable: options.lookupExecutable ?? ((name) => findExecutable(name, { platform, env })),
    openBrowser: options.openBrowser ?? ((url) => defaultOpenBrowser(url, platform)),
    sleep: options.sleep ?? sleep,
    stdin: options.stdin ?? process.stdin,
    signal: options.signal,
  };
}

/** Execute one `nstack linear` command and return its consumer-visible result. */
export async function linear(argv = [], options = {}) {
  const deps = dependencyDefaults(options);
  const raw = [...argv];
  if (raw[0] === "--help" || raw[0] === "-h") return { data: LINEAR_HELP, json: false };
  const json = raw.includes("--json");
  if (raw[0] === "auth") return { data: await authCommand(raw.slice(1).filter((arg) => arg !== "--json"), deps), json };
  const { flags, positional } = parseArgs(raw);
  const { command, operands } = splitCommand(positional);
  validateCommandFlags(command, flags);
  const maxOperands = command[0] === "search" ? Infinity : ["issue", "save-issue", "relation", "status", "assignee", "priority", "estimate", "due-date", "label", "comment", "attach"].includes(command[0]) ? 1 : 0;
  if (operands.length > maxOperands) fail("invalid_argument", `${command.join(" ")} accepts at most ${maxOperands} positional argument${maxOperands === 1 ? "" : "s"}`);
  const credential = authCredential(deps.env, deps.credentialPath, deps.now);
  const session = credential.session;
  if (credential.mode === "expired") fail("auth_expired", "The saved Linear session has expired. Run `nstack linear auth login` again.");
  let current;
  const needsCurrent = flags.current || flags["parent-current"];
  if (needsCurrent) current = currentOrca({ runner: deps.runner, lookupExecutable: deps.lookupExecutable, platform: deps.platform, env: deps.env });
  let body;
  if (command[0] === "comment" && command[1] === "add") body = await readBody(flags, { max: 20000, kind: "Comment body", stdin: deps.stdin });
  else if (["create", "save-issue"].includes(command[0])) body = await readBody(flags, { allowDescription: command[0] === "save-issue", max: 65000, kind: "Issue description", stdin: deps.stdin });
  const request = commandData(command, flags, operands, body);
  if (current) {
    if (request.args.current) {
      request.args.current = false;
      request.args.id = current.id;
      if (request.args.workspace === undefined && current.workspace) request.args.workspace = current.workspace;
    }
    if (request.args.parentCurrent) {
      request.args.parentCurrent = false;
      request.args.parentId = current.id;
      if (request.args.workspace === undefined && current.workspace) request.args.workspace = current.workspace;
    }
    if (request.operation === "issue.get" && current.response) return { data: current.response, json };
  }
  if (!deps.env.LINEAR_API_KEY && !session) fail("linear_not_connected", "Linear is not connected. Run `nstack linear auth login` or set LINEAR_API_KEY.");
  let result;
  if (SAFE_WRITE_OPS.has(request.operation) && request.args.id && request.operation !== "issue.create") {
    const preflightArgs = { id: request.args.id, workspace: request.args.workspace, full: false };
    if (request.operation === "comment.add") preflightArgs.comments = true;
    if (request.operation === "attachment.add") preflightArgs.attachments = true;
    if (request.operation.startsWith("relation.")) preflightArgs.relations = true;
    const currentIssue = await callLinear("issue.get", preflightArgs, deps, session);
    if (request.operation === "status.set") guardStatusTransition(request.args.to, currentIssue);
    if (currentIssue?.issue?.workspaceId && !request.args.workspace) request.args.workspace = currentIssue.issue.workspaceId;
  }
  try {
    result = await callLinear(request.operation, request.args, deps, session);
  } catch (error) {
    if (error.code === "linear_write_unconfirmed") {
      error.data = { ...(error.data ?? {}), nextSteps: error.data?.nextSteps ?? (request.args.id ? `Read issue ${request.args.id} back before deciding whether to retry.` : "Read the created issue back before deciding whether to retry.") };
      const idempotentReplay = request.args.writeId && error.data?.writeId === request.args.writeId;
      if (request.args.id && !idempotentReplay) {
        const readArgs = { id: request.args.id, workspace: request.args.workspace, full: false };
        if (request.operation === "comment.add") readArgs.comments = true;
        if (request.operation === "attachment.add") readArgs.attachments = true;
        if (request.operation.startsWith("relation.")) readArgs.relations = true;
        let readBack;
        try { readBack = await callLinear("issue.get", readArgs, deps, session); }
        catch (readError) { error.data = { ...(error.data ?? {}), readBackError: readError.code ?? "linear_network" }; }
        if (readBack !== undefined) {
          const observed = writeObserved(request.operation, request.args, readBack);
          if (observed === true) return { data: { writeConfirmed: true, issue: readBack.issue ?? readBack }, json };
          error.data = { ...(error.data ?? {}), readBack: observed === false ? "change-not-present" : "change-not-verifiable" };
          if (observed === false) {
            try { result = await callLinear(request.operation, request.args, deps, session, { retryWrite: false }); }
            catch (retryError) {
              retryError.data = { ...(retryError.data ?? {}), retryAttemptedAfterReadBack: true };
              throw retryError;
            }
          }
        }
      }
    }
    if (result === undefined) throw error;
  }
  return { data: normalizeResponse(result, request.operation, request.args), json };
}

function guardStatusTransition(target, issue) {
  const current = issue?.issue ?? issue;
  const currentType = String(current?.state?.type ?? "").toLowerCase();
  const targetState = String(target).toLowerCase();
  if (selectorMatch(current.state, target)) return;
  if (currentType === "completed" || currentType === "canceled") fail("invalid_state", "Completed or canceled issues are not moved to an earlier lifecycle state");
  if (["started", "completed", "canceled"].includes(currentType) && /^(triage|backlog|unstarted)$/.test(targetState)) fail("invalid_state", "Refusing to regress an issue to an earlier lifecycle state");
}

function nestedItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.nodes)) return value.nodes;
  if (Array.isArray(value?.edges)) return value.edges.map((edge) => edge.node).filter(Boolean);
  return null;
}

function selectorMatch(value, selector) {
  if (selector === null) return value == null;
  if (typeof selector !== "string" || selector === "me" || value == null) return false;
  if (typeof value === "string") return value === selector;
  return [value.id, value.name, value.identifier, value.key].some((candidate) => candidate === selector);
}

function fieldMatch(issue, field, expected) {
  return Object.hasOwn(issue, field) ? selectorMatch(issue[field], expected) : null;
}

function writeObserved(operation, args, response) {
  const issue = response?.issue ?? response?.data?.issue ?? response;
  if (!issue || typeof issue !== "object") return null;
  if (operation === "status.set") return fieldMatch(issue, "state", args.to);
  if (operation === "priority.set") return Object.hasOwn(issue, "priority") ? Number(issue.priority) === priority(args.to, "to") : null;
  if (operation === "priority.clear") return Object.hasOwn(issue, "priority") ? Number(issue.priority) === 0 : null;
  if (operation === "estimate.set") return Object.hasOwn(issue, "estimate") ? Number(issue.estimate) === Number(args.to) : null;
  if (operation === "estimate.clear") return Object.hasOwn(issue, "estimate") ? issue.estimate == null : null;
  if (operation === "dueDate.set") return typeof issue.dueDate === "string" ? issue.dueDate.slice(0, 10) === args.to : null;
  if (operation === "dueDate.clear") return Object.hasOwn(issue, "dueDate") ? issue.dueDate == null : null;
  if (operation === "assignee.clear") return Object.hasOwn(issue, "assignee") ? issue.assignee == null : null;
  if (operation === "assignee.set") return args.to === "me" ? null : fieldMatch(issue, "assignee", args.to);
  if (operation.startsWith("label.")) {
    const labels = nestedItems(issue.labels);
    if (!labels) return null;
    const has = (selector) => labels.some((label) => selectorMatch(label, selector));
    if (operation === "label.add") return args.labels.every(has);
    if (operation === "label.remove") return args.labels.every((label) => !has(label));
    return labels.length === args.labels.length && args.labels.every(has);
  }
  if (operation === "comment.add") {
    const comments = nestedItems(issue.comments);
    return comments ? comments.some((comment) => comment.body === args.body && (!args.replyTo || comment.parent?.id === args.replyTo || comment.parentId === args.replyTo)) : null;
  }
  if (operation === "attachment.add") {
    const attachments = nestedItems(issue.attachments);
    return attachments ? attachments.some((attachment) => attachment.url === args.url && (args.title === undefined || attachment.title === args.title)) : null;
  }
  if (operation === "issue.save") {
    const checks = [];
    if (args.title !== undefined) checks.push(Object.hasOwn(issue, "title") ? issue.title === args.title : null);
    if (args.description !== undefined) checks.push(Object.hasOwn(issue, "description") ? issue.description === args.description : null);
    if (args.state !== undefined) checks.push(fieldMatch(issue, "state", args.state));
    if (args.assignee !== undefined) checks.push(args.assignee === "me" ? null : fieldMatch(issue, "assignee", args.assignee));
    if (args.priority !== undefined) checks.push(Object.hasOwn(issue, "priority") ? Number(issue.priority) === args.priority : null);
    if (args.estimate !== undefined) checks.push(Object.hasOwn(issue, "estimate") ? issue.estimate === args.estimate : null);
    if (args.dueDate !== undefined) checks.push(Object.hasOwn(issue, "dueDate") ? (args.dueDate === null ? issue.dueDate == null : issue.dueDate?.slice(0, 10) === args.dueDate) : null);
    if (args.project !== undefined) checks.push(fieldMatch(issue, "project", args.project));
    if (args.parentId !== undefined) checks.push(fieldMatch(issue, "parent", args.parentId));
    if (args.labels !== undefined) {
      const labels = nestedItems(issue.labels);
      checks.push(labels ? labels.length === args.labels.length && args.labels.every((label) => labels.some((item) => selectorMatch(item, label))) : null);
    }
    return checks.length && checks.every((result) => result === true) ? true : checks.some((result) => result === false) ? false : null;
  }
  return null;
}

export function formatLinearResult(data) {
  return human(data);
}

export function formatLinearError(error) {
  if (error instanceof LinearError) return error.toJSON();
  return { code: "linear_network", message: error?.message ?? String(error) };
}

export function formatLinearHumanError(error) {
  const value = formatLinearError(error);
  return `${value.code}: ${value.message}${value.data === undefined ? "" : `\n${JSON.stringify(value.data, null, 2)}`}`;
}
