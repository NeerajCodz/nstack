import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALL_URL = "https://github.com/cli/cli/blob/trunk/docs/install_linux.md";
const RELEASE_URL = "https://api.github.com/repos/cli/cli/releases/latest";

function defaultRunner(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function versionFrom(output) {
  const match = String(output).match(/\bversion\s+(\d+\.\d+\.\d+)\b/i);
  return match?.[1] ?? null;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function linuxDistro(readFile = readFileSync) {
  try {
    const release = readFile("/etc/os-release", "utf8");
    return Object.fromEntries(release.split(/\r?\n/).map((line) => line.match(/^([A-Z_]+)=(.*)$/)?.slice(1)).filter(Boolean).map(([key, value]) => [key, value.replace(/^['"]|['"]$/g, "")]));
  } catch {
    return {};
  }
}

function installer(platform, { runner, distro, arch }) {
  if (platform === "win32") return { command: "winget", args: ["install", "--id", "GitHub.cli", "--exact", "--source", "winget"] };
  if (platform === "darwin") return { command: "brew", args: ["install", "gh"] };
  if (platform !== "linux") return null;
  const id = (distro.ID ?? "").toLowerCase();
  const like = (distro.ID_LIKE ?? "").toLowerCase();
  if (["ubuntu", "debian", "linuxmint", "pop"].includes(id) || /debian|ubuntu/.test(like)) {
    const key = join(tmpdir(), `nstack-gh-keyring-${process.pid}.gpg`);
    return { command: "sudo", args: ["apt", "install", "-y", "gh"], setup: async (fetchImpl) => {
      const response = await fetchImpl("https://cli.github.com/packages/githubcli-archive-keyring.gpg");
      if (!response.ok) throw new Error(`GitHub CLI signing key download failed (${response.status})`);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(key, Buffer.from(await response.arrayBuffer()));
      runner("sudo", ["install", "-D", "-m", "644", key, "/usr/share/keyrings/githubcli-archive-keyring.gpg"]);
      const source = `deb [arch=${arch} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n`;
      const sourceFile = join(tmpdir(), `nstack-gh-${process.pid}.list`);
      writeFileSync(sourceFile, source);
      runner("sudo", ["install", "-m", "644", sourceFile, "/etc/apt/sources.list.d/github-cli.list"]);
      runner("sudo", ["apt", "update"]);
    } };
  }
  if (["fedora", "rhel", "centos"].includes(id) || /fedora|rhel/.test(like)) return { command: "sudo", args: ["dnf", "install", "-y", "gh"] };
  if (["opensuse-tumbleweed", "opensuse-leap"].includes(id) || /suse/.test(like)) return { command: "sudo", args: ["zypper", "install", "-y", "gh"] };
  if (id === "arch" || /arch/.test(like)) return { command: "sudo", args: ["pacman", "-S", "--needed", "--noconfirm", "github-cli"] };
  return null;
}

export async function ensureGh({
  platform = process.platform,
  arch = process.arch === "x64" ? "amd64" : process.arch,
  runner = defaultRunner,
  fetchImpl = fetch,
  readFile = readFileSync,
  distro = null,
  log = console.log,
} = {}) {
  const getVersion = () => {
    try { return versionFrom(runner("gh", ["--version"])); } catch { return null; }
  };
  try {
    const response = await fetchImpl(RELEASE_URL, { headers: { "User-Agent": "nstack" } });
    if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`);
    const release = await response.json();
    const latest = versionFrom(release.tag_name ?? "") ?? String(release.tag_name ?? "").replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error("GitHub latest release returned an invalid version");
    let installed = getVersion();
    if (!installed) {
      const target = installer(platform, { runner, distro: distro ?? (platform === "linux" ? linuxDistro(readFile) : {}), arch });
      if (!target) throw new Error(`Cannot install GitHub CLI on this platform/package manager. Follow ${INSTALL_URL}`);
      try {
        if (target.setup) await target.setup(fetchImpl);
        runner(target.command, target.args);
      } catch (error) {
        throw new Error(`GitHub CLI installation failed using the official package source. Check package-manager output and follow ${platform === "linux" ? INSTALL_URL : "https://cli.github.com/"}. ${error.message}`);
      }
      installed = getVersion();
      if (!installed) throw new Error(`GitHub CLI is still unavailable after installation. Follow ${INSTALL_URL}`);
    }
    if (compareVersions(installed, latest) < 0) {
      log(`GitHub CLI ${installed} works, but latest is ${latest}; existing installations are not changed automatically.`);
    } else {
      log(`GitHub CLI ${installed} is current.`);
    }
    let authenticated = true;
    try { runner("gh", ["auth", "status"]); } catch { authenticated = false; }
    if (!authenticated) log("GitHub CLI authentication is required. Run: gh auth login");
    return { installedVersion: installed, latestVersion: latest, authenticated };
  } catch (error) {
    log(error.message);
    throw error;
  }
}

export async function detectOrca({ runner = defaultRunner } = {}) {
  try {
    const output = runner("orca", ["status", "--json"]);
    const status = JSON.parse(output);
    return status.reachable === true || status.connected === true ||
      ["running", "ready", "connected"].includes(String(status.status ?? "").toLowerCase());
  } catch {
    return false;
  }
}
