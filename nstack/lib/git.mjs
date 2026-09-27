import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { dirname, join } from "path";
import { execFileSync } from "child_process";

const DEFAULT_BRANCH = "main";

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(cwd, args) {
  try {
    return runGit(cwd, args);
  } catch {
    return null;
  }
}

function assertBranchName(branch) {
  if (
    !branch ||
    branch.startsWith("-") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    /[\s~^:?*[\\]/.test(branch) ||
    branch.endsWith("/") ||
    branch.endsWith(".")
  ) {
    throw new Error(`Invalid Git branch name: ${branch || "(empty)"}`);
  }
}

function installFile(source, target, force, summary) {
  const existed = existsSync(target);
  if (existed && !force) {
    summary.skipped.push(target);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  summary[existed ? "overwritten" : "created"].push(target);
}

function installTree(sourceDir, targetDir, force, summary) {
  if (!existsSync(sourceDir)) return;

  for (const entry of readdirSync(sourceDir)) {
    const source = join(sourceDir, entry);
    const target = join(targetDir, entry);
    if (statSync(source).isDirectory()) {
      installTree(source, target, force, summary);
    } else {
      installFile(source, target, force, summary);
    }
  }
}

function initializeRepository(cwd, branch) {
  if (tryGit(cwd, ["rev-parse", "--git-dir"])) {
    return { initialized: false, branch: tryGit(cwd, ["symbolic-ref", "--short", "HEAD"]) || branch };
  }

  try {
    runGit(cwd, ["init", "-b", branch]);
  } catch {
    runGit(cwd, ["init"]);
    runGit(cwd, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  }

  return { initialized: true, branch };
}

function configureCommitTemplate(cwd, force) {
  const configured = tryGit(cwd, ["config", "--local", "--get", "commit.template"]);
  if (configured && !force) return configured;

  runGit(cwd, ["config", "--local", "commit.template", ".gitmessage"]);
  return ".gitmessage";
}

/**
 * Initialize Git itself and install the repository's complete GitHub workflow.
 * Existing files are preserved unless force is explicitly requested.
 */
export async function initGit(cwd, componentsDir, options = {}) {
  const branch = options.branch || DEFAULT_BRANCH;
  const force = Boolean(options.force);
  assertBranchName(branch);

  const repository = initializeRepository(cwd, branch);
  const templatesDir = join(componentsDir, "templates");
  const summary = { created: [], overwritten: [], skipped: [] };

  installFile(
    join(templatesDir, "gitignore.template"),
    join(cwd, ".gitignore"),
    force,
    summary,
  );
  installFile(
    join(templatesDir, "git", "attributes"),
    join(cwd, ".gitattributes"),
    force,
    summary,
  );
  installFile(
    join(templatesDir, "git", "commit-message.txt"),
    join(cwd, ".gitmessage"),
    force,
    summary,
  );
  installTree(
    join(templatesDir, "github"),
    join(cwd, ".github"),
    force,
    summary,
  );
  installFile(
    join(templatesDir, "git", "branching.md"),
    join(cwd, ".github", "BRANCHING.md"),
    force,
    summary,
  );

  const commitTemplate = configureCommitTemplate(cwd, force);
  console.log(repository.initialized ? "Initialized Git repository." : "Git repository already initialized.");
  console.log(`Default branch: ${repository.branch}`);
  console.log(
    `Git scaffolding: ${summary.created.length} created, ` +
      `${summary.overwritten.length} overwritten, ${summary.skipped.length} preserved.`,
  );
  console.log(`Commit template: ${commitTemplate}`);
  console.log("GitHub issue, pull request, workflow, ownership, and branch templates are ready.");

  return { ...repository, commitTemplate, summary };
}
