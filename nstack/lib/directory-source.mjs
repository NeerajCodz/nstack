import { existsSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";

export const DIRECTORY_REPOSITORY = "https://github.com/NeerajCodz/nstack-directory.git";
export const DIRECTORY_BRANCH = "main";

export function resolveDirectorySource({
  refresh = false,
  home = homedir(),
  runGit = execFileSync,
  directoryPath = process.env.NSTACK_DIRECTORY_PATH,
  repositoryUrl = process.env.NSTACK_DIRECTORY_URL || DIRECTORY_REPOSITORY,
} = {}) {
  if (directoryPath) {
    if (!existsSync(directoryPath)) {
      throw new Error(`The specified nstack directory path does not exist: ${directoryPath}`);
    }
    if (refresh && existsSync(join(directoryPath, ".git"))) {
      try {
        runGit("git", ["-C", directoryPath, "pull", "--ff-only", "origin", DIRECTORY_BRANCH], { stdio: "pipe" });
      } catch (error) {
        const detail = error.stderr?.toString().trim() || error.message;
        throw new Error(`Unable to refresh the nstack component directory: ${detail}`);
      }
    }
    return directoryPath;
  }

  const cacheRoot = join(home, ".nstack");
  const directoryRoot = join(cacheRoot, "directory");
  mkdirSync(cacheRoot, { recursive: true });

  if (!existsSync(directoryRoot)) {
    try {
      runGit("git", ["clone", "--depth", "1", "--branch", DIRECTORY_BRANCH, repositoryUrl, directoryRoot], { stdio: "pipe" });
    } catch (error) {
      rmSync(directoryRoot, { recursive: true, force: true });
      const detail = error.stderr?.toString().trim() || error.message;
      throw new Error(`Unable to clone the nstack component directory. Check that Git is installed and the repository is reachable: ${detail}`);
    }
    return directoryRoot;
  }

  if (!existsSync(join(directoryRoot, ".git"))) {
    throw new Error(`The nstack directory cache is not a Git checkout: ${directoryRoot}`);
  }

  if (refresh) {
    try {
      runGit("git", ["-C", directoryRoot, "pull", "--ff-only", "origin", DIRECTORY_BRANCH], { stdio: "pipe" });
    } catch (error) {
      const detail = error.stderr?.toString().trim() || error.message;
      throw new Error(`Unable to refresh the nstack component directory: ${detail}`);
    }
  }

  return directoryRoot;
}
