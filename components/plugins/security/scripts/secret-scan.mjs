#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const SECRET_PATTERNS = [
  { pattern: /AKIA[0-9A-Z]{16}/g, name: "AWS Access Key" },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, name: "OpenAI/API Secret Key" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: "GitHub Personal Access Token" },
  { pattern: /gho_[a-zA-Z0-9]{36}/g, name: "GitHub OAuth Token" },
  { pattern: /glpat-[a-zA-Z0-9\-]{20,}/g, name: "GitLab Personal Access Token" },
  { pattern: /xox[bpors]-[a-zA-Z0-9\-]+/g, name: "Slack Token" },
  { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, name: "Private Key" },
  { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, name: "JWT Token" },
  { pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/gi, name: "Hardcoded Password" },
  { pattern: /secret\s*[:=]\s*['"][^'"]{8,}['"]/gi, name: "Hardcoded Secret" },
  { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/gi, name: "Hardcoded API Key" },
  { pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/g, name: "Bearer Token" },
  { pattern: /npm_[a-zA-Z0-9]{36}/g, name: "NPM Token" },
  { pattern: /pypi-[a-zA-Z0-9]{30,}/g, name: "PyPI Token" },
  { pattern: /SG\.[a-zA-Z0-9\-]{22}\.[a-zA-Z0-9]{43}/g, name: "SendGrid API Key" },
  { pattern: /sk_live_[a-zA-Z0-9]{24,}/g, name: "Stripe Secret Key" },
  { pattern: /rk_live_[a-zA-Z0-9]{24,}/g, name: "Stripe Restricted Key" },
  { pattern: /sq0csp-[a-zA-Z0-9\-]{32,}/g, name: "Square OAuth Secret" },
  { pattern: /AIza[0-9A-Za-z\-_]{35}/g, name: "Google API Key" },
  { pattern: /[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com/g, name: "Google OAuth Client ID" },
];

const SCAN_EXTENSIONS = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts",
  ".php", ".cs", ".fs", ".fsx", ".swift", ".dart",
  ".ex", ".exs", ".erl", ".hs", ".lua", ".r", ".R",
  ".env", ".json", ".yaml", ".yml", ".toml", ".xml",
  ".cfg", ".conf", ".ini", ".properties", ".tf", ".hcl",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  ".sql", ".graphql", ".gql", ".proto",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "target", "vendor", ".venv", "venv", "__pycache__", ".mypy_cache",
  ".ruff_cache", ".gradle", ".idea", ".vscode", "coverage",
  ".nstack", ".nstack", ".agents", ".claude",
]);

const findings = [];

function scanFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    for (const { pattern, name } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Skip obvious false positives
          if (match.includes("example") || match.includes("placeholder") || match.includes("xxx")) continue;
          findings.push({ file: filePath, type: name, preview: match.substring(0, 20) + "..." });
        }
      }
    }
  } catch {}
}

function scanDir(dir, depth = 0) {
  if (depth > 8) return;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (stat.isFile() && SCAN_EXTENSIONS.has(extname(entry).toLowerCase())) {
          scanFile(fullPath);
        }
      } catch {}
    }
  } catch {}
}

console.log("[security] scanning for leaked secrets...");
scanDir(".");

if (findings.length === 0) {
  console.log("[security] no secrets found");
} else {
  console.log(`[security] found ${findings.length} potential secret(s):`);
  for (const f of findings) {
    console.log(`  ${f.type}: ${f.file} (${f.preview})`);
  }
  process.exit(1);
}
