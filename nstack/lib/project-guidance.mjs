import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DEFAULT_AGENTS = join(dirname(fileURLToPath(import.meta.url)), "../../components/templates/nstack/AGENTS.md");

export function ensureProjectAgents(cwd) {
  const destination = join(cwd, "AGENTS.md");
  if (!existsSync(destination)) {
    writeFileSync(destination, readFileSync(DEFAULT_AGENTS));
  }
  return destination;
}
