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

// React Native / Expo
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
  if (has("tsconfig.json")) {
    run(`${pm} exec tsc --noEmit`, "tsc type check");
  }
}

// Flutter
if (has("pubspec.yaml")) {
  run("dart analyze", "dart analyze");
  run("dart format --output=none --set-exit-if-changed .", "dart format");
  if (has("analysis_options.yaml")) {
    run("dart fix --dry-run", "dart fix check");
  }
}

// Android (Kotlin/Java)
if (has("build.gradle", "build.gradle.kts")) {
  run("gradle lint", "gradle lint");
  run("gradle ktlintCheck", "gradle ktlint");
}
if (has("app/build.gradle", "app/build.gradle.kts")) {
  run("gradle :app:lint", "android lint");
}

// iOS (Swift)
if (has("Package.swift", "*.xcodeproj", "*.xcworkspace", "Podfile")) {
  if (has(".swiftlint.yml", ".swiftlint.yaml")) run("swiftlint lint --quiet", "swiftlint");
  if (has("Podfile")) run("pod install --repo-update", "pod install");
}

// Capacitor / Ionic
if (has("capacitor.config.ts", "capacitor.config.js", "ionic.config.json")) {
  const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
  run(`${pm} run lint`, "ionic lint");
}

// React Native CLI
if (has("react-native.config.js")) {
  const pm = has("yarn.lock") ? "yarn" : "npm";
  run(`${pm} run lint`, "react-native lint");
}

console.log("[lint] done");
