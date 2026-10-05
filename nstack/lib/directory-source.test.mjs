import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import test from "node:test";
import { DIRECTORY_REPOSITORY, resolveDirectorySource } from "./directory-source.mjs";

function withHome(run) {
  const home = mkdtempSync(join(tmpdir(), "nstack-directory-test-"));
  return Promise.resolve(run(home)).finally(() => rmSync(home, { recursive: true, force: true }));
}

test("first use shallow-clones main under the user nstack cache and reuses it", async () => {
  await withHome(async (home) => {
    const calls = [];
    const runGit = (binary, args) => {
      calls.push([binary, args]);
      const destination = args.at(-1);
      mkdirSync(join(destination, ".git"), { recursive: true });
    };
    const expected = join(home, ".nstack", "directory");
    assert.equal(resolveDirectorySource({ home, runGit }), expected);
    assert.deepEqual(calls, [["git", ["clone", "--depth", "1", "--branch", "main", DIRECTORY_REPOSITORY, expected]]]);
    assert.equal(resolveDirectorySource({ home, runGit }), expected);
    assert.equal(calls.length, 1);
  });
});

test("refresh pulls main in the cached checkout", async () => {
  await withHome(async (home) => {
    const directoryRoot = join(home, ".nstack", "directory");
    mkdirSync(join(directoryRoot, ".git"), { recursive: true });
    const calls = [];
    const runGit = (_binary, args) => calls.push(args);
    assert.equal(resolveDirectorySource({ home, refresh: true, runGit }), directoryRoot);
    assert.deepEqual(calls, [["-C", directoryRoot, "pull", "--ff-only", "origin", "main"]]);
  });
});

test("clone and refresh failures explain the Git/source error without accepting a partial cache", async () => {
  await withHome(async (home) => {
    assert.throws(
      () => resolveDirectorySource({ home, runGit: () => { throw new Error("git not found"); } }),
      /Git is installed.*git not found/,
    );
    assert.equal(existsSync(join(home, ".nstack", "directory")), false);

    const directoryRoot = join(home, ".nstack", "directory");
    mkdirSync(directoryRoot, { recursive: true });
    assert.throws(() => resolveDirectorySource({ home }), /not a Git checkout/);
  });
});
