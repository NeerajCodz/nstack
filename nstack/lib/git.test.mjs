import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import test from "node:test";
import assert from "node:assert/strict";
import { initGit } from "./git.mjs";

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "components");


function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("initGit creates a complete GitHub workflow and initial branch", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "nstack-git-"));
  const result = await initGit(cwd, componentsDir, { branch: "develop" });

  assert.equal(result.initialized, true);
  assert.equal(result.branch, "develop");
  assert.equal(git(cwd, ["symbolic-ref", "--short", "HEAD"]), "develop");
  assert.equal(git(cwd, ["config", "--local", "--get", "commit.template"]), ".gitmessage");
  assert.match(readFileSync(join(cwd, ".gitmessage"), "utf8"), /Commit message format/);
  assert.match(readFileSync(join(cwd, ".github", "BRANCHING.md"), "utf8"), /feat\//);
  assert.match(readFileSync(join(cwd, ".github", "ISSUE_TEMPLATE", "bug_report.yml"), "utf8"), /name:/);
  assert.match(readFileSync(join(cwd, ".github", "CODEOWNERS"), "utf8"), /@your-org/);
});

test("initGit preserves existing files on rerun", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "nstack-git-"));
  await initGit(cwd, componentsDir);
  writeFileSync(join(cwd, ".gitmessage"), "custom template\n");

  const result = await initGit(cwd, componentsDir, { branch: "release" });

  assert.equal(result.initialized, false);
  assert.equal(result.branch, "main");
  assert.equal(result.summary.created.length, 0);
  assert.equal(result.summary.overwritten.length, 0);
  assert.equal(result.summary.skipped.length, 20);
  assert.equal(readFileSync(join(cwd, ".gitmessage"), "utf8"), "custom template\n");
  assert.equal(git(cwd, ["config", "--local", "--get", "commit.template"]), ".gitmessage");

  const forced = await initGit(cwd, componentsDir, { force: true });
  assert.equal(forced.summary.created.length, 0);
  assert.equal(forced.summary.overwritten.length, 20);
  assert.match(readFileSync(join(cwd, ".gitmessage"), "utf8"), /Commit message format/);
});
