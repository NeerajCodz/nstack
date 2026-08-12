/**
 * Adapter registry
 */

import { ClaudeAdapter } from "./claude.mjs";
import { OpenClaudeAdapter } from "./openclaude.mjs";
import { CodexAdapter } from "./codex.mjs";
import { GeminiAdapter } from "./gemini.mjs";
import { CopilotAdapter } from "./copilot.mjs";
import { OpenCodeAdapter } from "./opencode.mjs";
import { OmpAdapter } from "./omp.mjs";
import { AgyAdapter } from "./agy.mjs";
import { CursorAdapter } from "./cursor.mjs";

const ADAPTERS = {
  claude: new ClaudeAdapter(),
  openclaude: new OpenClaudeAdapter(),
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
  agy: new AgyAdapter(),
  antigravity: new AgyAdapter(),
  copilot: new CopilotAdapter(),
  opencode: new OpenCodeAdapter(),
  omp: new OmpAdapter(),
  cursor: new CursorAdapter(),
};

export function getAdapter(tool) {
  return ADAPTERS[tool] || null;
}

export function listAdapters() {
  return Object.keys(ADAPTERS);
}
