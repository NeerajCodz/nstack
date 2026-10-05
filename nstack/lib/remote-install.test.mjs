import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import test from "node:test";
import { createDefaultConfig, readConfig, writeConfig } from "./config.mjs";
import { installRemoteFolder, parseGitHubFolderUrl } from "./installer.mjs";

const repository = "https://github.com/example/components";

function withProject(run) {
  const root = mkdtempSync(join(tmpdir(), "nstack-remote-test-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  const config = createDefaultConfig();
  config.projectHome = true;
  config.tools.fixture = { name: "fixture" };
  writeConfig(cwd, config);
  return Promise.resolve(run({ root, cwd })).finally(() => rmSync(root, { recursive: true, force: true }));
}

function fakeAdapter(fail = false) {
  const calls = [];
  const install = async (type, cwd, source, name) => {
    calls.push({ type, source, name });
    if (fail) throw new Error("adapter failed");
    const destination = join(cwd, "installed", type, name);
    mkdirSync(join(destination, ".."), { recursive: true });
    if (statSync(source).isDirectory()) cpSync(source, destination, { recursive: true });
    else cpSync(source, destination);
  };
  return {
    calls,
    adapter: {
      installPlugin: (...args) => install("plugin", ...args),
      installSkill: (...args) => install("skill", ...args),
      installAgent: (...args) => install("agent", ...args),
      installCommand: (...args) => install("command", ...args),
      installMcp: (...args) => install("mcp", ...args),
    },
  };
}

function fakeCheckout(root, fileMap) {
  let checkoutPath;
  return {
    get path() { return checkoutPath; },
    createTempDirectory: () => {
      checkoutPath = mkdtempSync(join(root, "checkout-"));
      return checkoutPath;
    },
    cloneCheckout: async (_url, checkout, parsed) => {
      for (const [relativePath, content] of Object.entries(fileMap)) {
        const destination = join(checkout, ...parsed.path.split("/"), relativePath);
        mkdirSync(join(destination, ".."), { recursive: true });
        writeFileSync(destination, content);
      }
    },
  };
}

function treeUrl(category, folder) {
  return `${repository}/tree/main/${category}/${folder}`;
}

test("GitHub folder URLs split owner, repository, ref, and singular category paths", () => {
  assert.deepEqual(
    parseGitHubFolderUrl(`${repository}/tree/release-42/plugin/security/nested`, "plugins"),
    { owner: "example", repo: "components", ref: "release-42", path: "plugin/security/nested", type: "plugin" },
  );
  assert.equal(parseGitHubFolderUrl(treeUrl("skills", "security-review"), "skills").path, "skills/security-review");
  assert.throws(
    () => parseGitHubFolderUrl(`${repository}/tree/feature/branch/plugins/demo`, "plugin"),
    /single path segment/,
  );
});

test("malformed, unsupported, and mismatched GitHub folder URLs are rejected", () => {
  for (const [url, type] of [
    ["http://github.com/example/components/tree/main/plugins/demo", "plugin"],
    ["https://github.com/example/components/blob/main/plugins/demo", "plugin"],
    [`${repository}/tree/main`, "plugin"],
    [`${repository}/tree/main/plugins`, "plugin"],
    [`${repository}/tree/main/skills/demo?download=1`, "plugin"],
    [`${repository}/tree/main/plugins/demo`, "hook"],
    [`${repository}/tree/main/skills/demo`, "plugin"],
  ]) {
    assert.throws(() => parseGitHubFolderUrl(url, type));
  }
});

for (const scenario of [
  {
    type: "plugins", url: treeUrl("plugins", "group/remote-plugin"), files: { "README.md": "plugin payload" },
    name: "remote-plugin", installedFile: ["plugin", "remote-plugin", "README.md"],
  },
  {
    type: "skills", url: treeUrl("skills", "remote-skill"), files: { "SKILL.md": "skill payload" },
    name: "remote-skill", installedFile: ["skill", "remote-skill", "SKILL.md"],
  },
  {
    type: "agents", url: treeUrl("agents", "agent-folder"), files: { "alpha.md": "alpha", "beta.md": "beta", "nested/ignored.md": "nested" },
    names: ["alpha", "beta"], installedFile: ["agent", "alpha"],
  },
  {
    type: "commands", url: treeUrl("commands", "command-folder"), files: { "run.md": "command", "nested/ignored.md": "nested" },
    name: "run", installedFile: ["command", "run"],
  },
  {
    type: "mcps", url: treeUrl("mcps", "mcp-folder"), files: { "server.json": "{\"name\":\"server\",\"command\":\"node\"}", "nested/ignored.json": "{}" },
    name: "server", installedFile: ["mcp", "server"],
  },
]) {
  test(`remote ${scenario.type} folder installs compatible entries and records names`, async () => {
    await withProject(async ({ root, cwd }) => {
      const clone = fakeCheckout(root, scenario.files);
      const { adapter, calls } = fakeAdapter();
      const names = await installRemoteFolder(cwd, scenario.type, scenario.url, {
        ...clone,
        getAdapterForTool: () => adapter,
      });
      const expectedNames = scenario.names || [scenario.name];
      assert.deepEqual(names, expectedNames);
      assert.deepEqual(calls.map(({ name }) => name), expectedNames);
      const expectedType = scenario.type === "plugins" ? "plugins" : scenario.type;
      const records = readConfig(cwd).installed[expectedType];
      assert.deepEqual(records.map(({ name }) => name), expectedNames);
      for (const name of expectedNames) {
        const ref = records.find((item) => item.name === name).ref;
        assert.ok(ref.endsWith(name) || ref.endsWith(`${name}.md`) || ref.endsWith(`${name}.json`));
      }
      if (scenario.installedFile.length === 3) {
        assert.equal(readFileSync(join(cwd, "installed", ...scenario.installedFile), "utf8"), scenario.type === "plugins" ? "plugin payload" : "skill payload");
      } else if (scenario.installedFile.length === 2) {
        assert.ok(existsSync(join(cwd, "installed", ...scenario.installedFile)));
      }
      assert.equal(existsSync(clone.path), false);
    });
  });
}

test("missing folders and incompatible empty folders fail before adapter writes", async () => {
  await withProject(async ({ root, cwd }) => {
    const missing = fakeCheckout(root, {});
    const { adapter, calls } = fakeAdapter();
    await assert.rejects(
      installRemoteFolder(cwd, "plugins", treeUrl("plugins", "missing"), { ...missing, getAdapterForTool: () => adapter }),
      /GitHub folder does not exist/,
    );
    assert.deepEqual(calls, []);
    assert.equal(readConfig(cwd).installed.plugins.length, 0);
    assert.equal(existsSync(missing.path), false);

    const empty = fakeCheckout(root, { "nested/only.md": "not a direct child" });
    await assert.rejects(
      installRemoteFolder(cwd, "agents", treeUrl("agents", "empty"), { ...empty, getAdapterForTool: () => adapter }),
      /No direct-child \.md files/,
    );
    assert.deepEqual(calls, []);
    assert.equal(readConfig(cwd).installed.agents.length, 0);
    assert.equal(existsSync(empty.path), false);
  });
});

test("a failing adapter leaves no installed registry record and removes the sparse checkout", async () => {
  await withProject(async ({ root, cwd }) => {
    const clone = fakeCheckout(root, { "README.md": "plugin payload" });
    const { adapter } = fakeAdapter(true);
    await assert.rejects(
      installRemoteFolder(cwd, "plugins", treeUrl("plugins", "failure"), {
        ...clone,
        getAdapterForTool: () => adapter,
      }),
      /adapter failed/,
    );
    assert.equal(readConfig(cwd).installed.plugins.length, 0);
    assert.equal(existsSync(clone.path), false);
  });
});

test("invalid MCP manifests and skill folders without SKILL.md do not install partial content", async () => {
  await withProject(async ({ root, cwd }) => {
    const { adapter, calls } = fakeAdapter();
    const invalidMcp = fakeCheckout(root, { "good.json": "{\"name\":\"good\",\"url\":\"https://example.test\"}", "bad.json": "{\"name\":\"bad\"}" });
    await assert.rejects(
      installRemoteFolder(cwd, "mcps", treeUrl("mcps", "invalid"), { ...invalidMcp, getAdapterForTool: () => adapter }),
      /needs command or url/,
    );
    assert.deepEqual(calls, []);
    assert.equal(readConfig(cwd).installed.mcps.length, 0);

    const invalidSkill = fakeCheckout(root, { "README.md": "no skill" });
    await assert.rejects(
      installRemoteFolder(cwd, "skills", treeUrl("skills", "invalid"), { ...invalidSkill, getAdapterForTool: () => adapter }),
      /must contain SKILL\.md/,
    );
    assert.deepEqual(calls, []);
    assert.equal(readConfig(cwd).installed.skills.length, 0);
    assert.equal(existsSync(invalidMcp.path), false);
    assert.equal(existsSync(invalidSkill.path), false);
  });
});
