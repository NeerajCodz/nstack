#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

const run = (cmd, label) => {
  try {
    console.log(`[lint] ${label || cmd}`);
    execSync(cmd, { stdio: "inherit", timeout: 60000 });
  } catch (e) {
    if (e.status !== 0) console.log(`[lint] ${label || cmd} — issues found`);
  }
};

const has = (...files) => files.some((f) => existsSync(f));

// JavaScript / TypeScript
if (has("package.json")) {
  let scripts = {};
  try {
    scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts || {};
  } catch {}

  const pm = has("bun.lockb", "bun.lock") ? "bun" : has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";

  if (scripts.lint) run(`${pm} run lint`, `${pm} run lint`);
  if (scripts.format) run(`${pm} run format`, `${pm} run format`);

  if (has(".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs")) {
    run(`${pm} exec eslint . --max-warnings=0`, "eslint");
  }
  if (has(".prettierrc", ".prettierrc.js", ".prettierrc.json", "prettier.config.js")) {
    run(`${pm} exec prettier --check .`, "prettier check");
  }
  if (has("tsconfig.json")) {
    run(`${pm} exec tsc --noEmit`, "tsc type check");
  }
}

// Python
if (has("pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile")) {
  if (has("ruff.toml", ".ruff.toml")) {
    run("ruff check .", "ruff");
    run("ruff format --check .", "ruff format");
  }
  if (has(".flake8", "setup.cfg")) run("flake8 .", "flake8");
  if (has("mypy.ini", ".mypy.ini")) run("mypy .", "mypy");
}

// Go
if (has("go.mod")) {
  run("gofmt -l .", "gofmt check");
  run("go vet ./...", "go vet");
  if (has(".golangci.yml", ".golangci.yaml", ".golangci.json")) run("golangci-lint run", "golangci-lint");
}

// Rust
if (has("Cargo.toml")) {
  run("cargo fmt --check", "cargo fmt");
  run("cargo clippy -- -D warnings", "cargo clippy");
}

// Java / Kotlin
if (has("pom.xml")) {
  run("mvn checkstyle:check", "maven checkstyle");
  run("mvn spotless:check", "maven spotless");
}
if (has("build.gradle", "build.gradle.kts")) {
  run("gradle lint", "gradle lint");
  run("gradle ktlintCheck", "gradle ktlint");
}

// Ruby
if (has("Gemfile")) run("bundle exec rubocop --lint", "rubocop");

// PHP
if (has("composer.json")) {
  run("composer lint", "composer lint");
  if (has("phpcs.xml", ".phpcs.xml")) run("vendor/bin/phpcs", "phpcs");
  if (has("phpstan.neon", "phpstan.neon.dist")) run("vendor/bin/phpstan analyse", "phpstan");
}

// C# / .NET
if (has("*.csproj", "*.sln", "*.fsproj")) run("dotnet format --verify-no-changes", "dotnet format");

// Swift
if (has("Package.swift", "*.xcodeproj", "*.xcworkspace")) {
  if (has(".swiftlint.yml", ".swiftlint.yaml")) run("swiftlint lint --quiet", "swiftlint");
}

// Dart / Flutter
if (has("pubspec.yaml")) {
  run("dart analyze", "dart analyze");
  run("dart format --output=none --set-exit-if-changed .", "dart format");
}

// Elixir
if (has("mix.exs")) run("mix format --check-formatted", "mix format");

// Haskell
if (has("*.cabal", "stack.yaml", "cabal.project")) {
  if (has(".hlint.yaml")) run("hlint .", "hlint");
}

// Zig
if (has("build.zig")) run("zig fmt --check .", "zig fmt");

// Makefile
if (has("Makefile")) run("make lint", "make lint");

console.log("[lint] done");
