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

test("NSTACK_DIRECTORY_PATH bypasses git clone and returns existing directory", async () => {
  const customDir = mkdtempSync(join(tmpdir(), "nstack-custom-dir-"));
  try {
    const calls = [];
    const runGit = (...args) => calls.push(args);

    // Pass directoryPath option directly
    const result = resolveDirectorySource({ directoryPath: customDir, runGit });
    assert.equal(result, customDir);
    assert.equal(calls.length, 0);

    // Refresh when no .git exists succeeds without running git
    const refreshed = resolveDirectorySource({ directoryPath: customDir, refresh: true, runGit });
    assert.equal(refreshed, customDir);
    assert.equal(calls.length, 0);

    // Via environment variable
    const prev = process.env.NSTACK_DIRECTORY_PATH;
    try {
      process.env.NSTACK_DIRECTORY_PATH = customDir;
      const envResult = resolveDirectorySource({ runGit });
      assert.equal(envResult, customDir);
      assert.equal(calls.length, 0);
    } finally {
      if (prev === undefined) delete process.env.NSTACK_DIRECTORY_PATH;
      else process.env.NSTACK_DIRECTORY_PATH = prev;
    }
  } finally {
    rmSync(customDir, { recursive: true, force: true });
  }
});

test("nonexistent NSTACK_DIRECTORY_PATH throws expected error", () => {
  const missing = join(tmpdir(), "nonexistent-dir-" + Date.now());
  assert.throws(
    () => resolveDirectorySource({ directoryPath: missing }),
    new RegExp("The specified nstack directory path does not exist: " + missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("NSTACK_DIRECTORY_URL directs clone command to overridden repository URL", async () => {
  await withHome(async (home) => {
    const customUrl = "https://github.com/custom/nstack-directory.git";
    const calls = [];
    const runGit = (binary, args) => {
      calls.push([binary, args]);
      const destination = args.at(-1);
      mkdirSync(join(destination, ".git"), { recursive: true });
    };
    const expected = join(home, ".nstack", "directory");

    assert.equal(resolveDirectorySource({ home, repositoryUrl: customUrl, runGit }), expected);
    assert.deepEqual(calls[0], ["git", ["clone", "--depth", "1", "--branch", "main", customUrl, expected]]);

    // Via environment variable
    const home2 = mkdtempSync(join(tmpdir(), "nstack-directory-test2-"));
    const prev = process.env.NSTACK_DIRECTORY_URL;
    try {
      process.env.NSTACK_DIRECTORY_URL = customUrl;
      const expected2 = join(home2, ".nstack", "directory");
      const calls2 = [];
      const runGit2 = (binary, args) => {
        calls2.push([binary, args]);
        const destination = args.at(-1);
        mkdirSync(join(destination, ".git"), { recursive: true });
      };
      assert.equal(resolveDirectorySource({ home: home2, runGit: runGit2 }), expected2);
      assert.deepEqual(calls2[0], ["git", ["clone", "--depth", "1", "--branch", "main", customUrl, expected2]]);
    } finally {
      if (prev === undefined) delete process.env.NSTACK_DIRECTORY_URL;
      else process.env.NSTACK_DIRECTORY_URL = prev;
      rmSync(home2, { recursive: true, force: true });
    }
  });
});
