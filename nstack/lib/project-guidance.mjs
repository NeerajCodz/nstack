import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export function ensureProjectAgents(cwd, directoryRoot) {
  const source = join(directoryRoot, "templates", "nstack", "AGENTS.md");
  const destination = join(cwd, "AGENTS.md");
  if (!existsSync(destination)) {
    writeFileSync(destination, readFileSync(source));
  }
  return destination;
}
