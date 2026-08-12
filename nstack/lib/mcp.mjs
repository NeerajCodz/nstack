import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export const MCP_SCHEMA_URL = "https://modelcontextprotocol.io/schemas/2025-06-18/server.schema.json";

export function readMcpManifest(filePath) {
  const manifest = JSON.parse(readFileSync(filePath, "utf8"));
  if (!manifest.name) throw new Error(`MCP manifest is missing name: ${filePath}`);
  if (!manifest.command && !manifest.url) {
    throw new Error(`MCP manifest needs command or url: ${filePath}`);
  }
  return manifest;
}

export function normalizeTransport(manifest) {
  if (manifest.url) return manifest.transport === "sse" ? "sse" : "http";
  return "stdio";
}

function envMap(manifest, style) {
  const vars = manifest.envVars || [];
  if (style === "claude") {
    return Object.fromEntries(vars.map((name) => [name, `\${${name}}`]));
  }
  if (style === "opencode") {
    return Object.fromEntries(vars.map((name) => [name, `{env:${name}}`]));
  }
  return undefined;
}

export function toClaudeServer(manifest) {
  const transport = normalizeTransport(manifest);
  if (transport === "stdio") {
    return {
      command: manifest.command,
      ...(manifest.args ? { args: manifest.args } : {}),
      ...(envMap(manifest, "claude") ? { env: envMap(manifest, "claude") } : {}),
    };
  }
  return {
    type: transport,
    url: manifest.url,
    ...(manifest.headers ? { headers: manifest.headers } : {}),
  };
}

export function toCodexServer(manifest) {
  const transport = normalizeTransport(manifest);
  if (transport === "stdio") {
    return {
      command: manifest.command,
      ...(manifest.args ? { args: manifest.args } : {}),
      ...(manifest.envVars ? { env_vars: manifest.envVars } : {}),
    };
  }
  return {
    url: manifest.url,
    ...(manifest.bearerTokenEnvVar ? { bearer_token_env_var: manifest.bearerTokenEnvVar } : {}),
    ...(manifest.headers ? { http_headers: manifest.headers } : {}),
  };
}

export function toOpenCodeServer(manifest) {
  const transport = normalizeTransport(manifest);
  if (transport === "stdio") {
    return {
      type: "local",
      command: [manifest.command, ...(manifest.args || [])],
      ...(envMap(manifest, "opencode") ? { environment: envMap(manifest, "opencode") } : {}),
      enabled: manifest.enabledByDefault !== false,
    };
  }
  return {
    type: "remote",
    url: manifest.url,
    ...(manifest.headers ? { headers: manifest.headers } : {}),
    enabled: manifest.enabledByDefault !== false,
  };
}

export function toOmpServer(manifest) {
  const transport = normalizeTransport(manifest);
  if (transport === "stdio") {
    return {
      type: "stdio",
      command: manifest.command,
      ...(manifest.args ? { args: manifest.args } : {}),
      ...(manifest.env ? { env: manifest.env } : {}),
    };
  }
  return {
    type: transport === "http" ? "http" : "sse",
    url: manifest.url,
    ...(manifest.headers ? { headers: manifest.headers } : {}),
  };
}

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlArray(values) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

export function toCodexToml(manifest) {
  const server = toCodexServer(manifest);
  const lines = [`[mcp_servers.${manifest.name}]`];
  for (const [key, value] of Object.entries(server)) {
    lines.push(`${key} = ${Array.isArray(value) ? tomlArray(value) : tomlString(value)}`);
  }
  return lines.join("\n") + "\n";
}

export function upsertTomlTable(filePath, header, block) {
  let text = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escapedHeader}\\r?\\n[\\s\\S]*?(?=^\\[[^\\n]+\\]\\s*$|\\s*$)`, "m");
  text = matcher.test(text) ? text.replace(matcher, block.trimEnd()) : `${text.trimEnd()}${text.trimEnd() ? "\\n\\n" : ""}${block}`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

export function mergeJsonFile(filePath, update) {
  let current = {};
  if (existsSync(filePath)) {
    current = JSON.parse(readFileSync(filePath, "utf8"));
  }
  const next = update(current);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function removeJsonMcp(filePath, name, keys = ["mcpServers", "mcp"]) {
  if (!existsSync(filePath)) return false;
  const current = JSON.parse(readFileSync(filePath, "utf8"));
  let removed = false;
  for (const key of keys) {
    if (current[key] && Object.prototype.hasOwnProperty.call(current[key], name)) {
      delete current[key][name];
      removed = true;
    }
  }
  if (removed) writeFileSync(filePath, JSON.stringify(current, null, 2) + "\n", "utf8");
  return removed;
}

export function removeTomlTable(filePath, header) {
  if (!existsSync(filePath)) return false;
  const text = readFileSync(filePath, "utf8");
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escapedHeader}\\r?\\n[\\s\\S]*?(?=^\\[[^\\n]+\\]\\s*$|\\s*$)`, "m");
  if (!matcher.test(text)) return false;
  const next = text.replace(matcher, "").replace(/\n{3,}/g, "\n\n").trim();
  writeFileSync(filePath, next ? `${next}\n` : "", "utf8");
  return true;
}
