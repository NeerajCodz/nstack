#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

const run = (cmd, label) => {
  try {
    console.log(`[test] ${label || cmd}`);
    execSync(cmd, { stdio: "inherit", timeout: 120000 });
    return true;
  } catch (e) {
    if (e.status !== 0) console.log(`[test] ${label || cmd} — failed (exit ${e.status})`);
    return false;
  }
};

const has = (...files) => files.some((f) => existsSync(f));
const pm = has("bun.lockb", "bun.lock") ? "bun" : has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";

// JavaScript / TypeScript
if (has("package.json")) {
  let scripts = {};
  try {
    scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts || {};
  } catch {}

  if (scripts.test) run(`${pm} run test`, `${pm} run test`);
  if (scripts["test:coverage"]) run(`${pm} run test:coverage`, `${pm} run test:coverage`);
  if (scripts["test:unit"]) run(`${pm} run test:unit`, `${pm} run test:unit`);
  if (scripts["test:e2e"]) run(`${pm} run test:e2e`, `${pm} run test:e2e`);

  // Jest
  if (has("jest.config.js", "jest.config.ts", "jest.config.mjs")) {
    run(`${pm} exec jest --passWithNoTests`, "jest");
  }

  // Vitest
  if (has("vitest.config.ts", "vitest.config.js", "vitest.config.mjs")) {
    run(`${pm} exec vitest run`, "vitest");
  }

  // Playwright
  if (has("playwright.config.ts", "playwright.config.js")) {
    run(`${pm} exec playwright test`, "playwright");
  }

  // Cypress
  if (has("cypress.config.ts", "cypress.config.js", "cypress.json")) {
    run(`${pm} exec cypress run`, "cypress");
  }
}

// Python
if (has("pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile")) {
  if (has("pytest.ini", ".pytest.ini", "conftest.py") || has("pyproject.toml")) {
    try {
      const pyproject = has("pyproject.toml") ? readFileSync("pyproject.toml", "utf8") : "";
      if (pyproject.includes("pytest") || has("pytest.ini", ".pytest.ini", "conftest.py")) {
        run("pytest", "pytest");
      }
    } catch {}
  }
  if (has("tox.ini")) run("tox", "tox");
}

// Go
if (has("go.mod")) {
  run("go test ./...", "go test");
  run("go test -race ./...", "go test -race");
  run("go test -cover ./...", "go test -cover");
}

// Rust
if (has("Cargo.toml")) {
  run("cargo test", "cargo test");
}

// Java / Kotlin
if (has("pom.xml")) {
  run("mvn test", "maven test");
}
if (has("build.gradle", "build.gradle.kts")) {
  run("gradle test", "gradle test");
}

// Ruby
if (has("Gemfile")) {
  if (has("spec", "test")) run("bundle exec rspec", "rspec");
  if (has("test")) run("bundle exec rake test", "rake test");
}

// PHP
if (has("composer.json")) {
  if (has("phpunit.xml", "phpunit.xml.dist")) run("vendor/bin/phpunit", "phpunit");
}

// C# / .NET
if (has("*.csproj", "*.sln", "*.fsproj")) {
  run("dotnet test", "dotnet test");
}

// Swift
if (has("Package.swift", "*.xcodeproj", "*.xcworkspace")) {
  run("swift test", "swift test");
  if (has("*.xcodeproj")) run("xcodebuild test", "xcodebuild test");
}

// Dart / Flutter
if (has("pubspec.yaml")) {
  run("flutter test", "flutter test");
  run("dart test", "dart test");
}

// Elixir
if (has("mix.exs")) {
  run("mix test", "mix test");
}

// Haskell
if (has("*.cabal", "stack.yaml", "cabal.project")) {
  run("cabal test", "cabal test");
  if (has("stack.yaml")) run("stack test", "stack test");
}

// Zig
if (has("build.zig")) {
  run("zig build test", "zig test");
}

// Makefile
if (has("Makefile")) {
  try {
    const makefile = readFileSync("Makefile", "utf8");
    if (makefile.includes("test:")) run("make test", "make test");
  } catch {}
}

console.log("[test] done");
