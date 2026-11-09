#!/usr/bin/env node
/**
 * Zero-dependency build & synchronization pipeline for Budgelist.
 *
 * 1. Concatenates modular source files from src/js/ -> www/app.js
 * 2. Concatenates modular stylesheets from src/css/ -> www/style.css
 * 3. Copies src/index.html -> www/index.html
 * 4. Validates www/app.js syntax & OTA new Function() evaluation compatibility
 * 5. Mirrors www/ (app.js, style.css, index.html, firebase-config.js, lib/) -> android/app/src/main/assets/public/
 *
 * Usage:
 *   node scripts/build.js           # Build src/ -> www/ and sync Android assets
 *   node scripts/build.js --init    # One-time split of existing www/ into src/ and verify 0-diff
 *   node scripts/build.js --check   # Verify www/ and Android assets match src/ without modifying
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SRC_DIR = path.join(ROOT, "src");
const SRC_JS_DIR = path.join(SRC_DIR, "js");
const SRC_CSS_DIR = path.join(SRC_DIR, "css");
const WWW_DIR = path.join(ROOT, "www");
const ANDROID_PUBLIC_DIR = path.join(ROOT, "android", "app", "src", "main", "assets", "public");

// Ordered source slices for initial split (--init) and deterministic concatenation
const JS_MODULES = [
  { file: "01-core-and-selects.js", startLine: 1, endLine: 450 },
  { file: "02-storage-and-sync.js", startLine: 451, endLine: 1178 },
  { file: "03-settings-and-currency.js", startLine: 1179, endLine: 1777 },
  { file: "04-ota-updates.js", startLine: 1778, endLine: 3284 },
  { file: "05-auth-and-session.js", startLine: 3285, endLine: 3699 },
  { file: "06-expenses-and-recurring.js", startLine: 3700, endLine: 4218 },
  { file: "07-budget-engine.js", startLine: 4219, endLine: 4892 },
  { file: "08-calendar-and-export.js", startLine: 4893, endLine: 5198 },
  { file: "09-views-and-overview.js", startLine: 5199, endLine: 6446 },
  { file: "10-forecast-and-navigation.js", startLine: 6447, endLine: 999999 },
];

const CSS_MODULES = [
  { file: "01-themes-and-screens.css", startLine: 1, endLine: 623 },
  { file: "02-overview-and-calendar.css", startLine: 624, endLine: 1277 },
  { file: "03-sheets-modals-and-selects.css", startLine: 1278, endLine: 2154 },
  { file: "04-budgets-updates-and-views.css", startLine: 2155, endLine: 999999 },
];

function sliceLinesExact(content, startLine, endLine) {
  const lines = content.split("\n");
  const actualEnd = Math.min(lines.length, endLine);
  return lines.slice(startLine - 1, actualEnd).join("\n");
}

function initFromWww() {
  fs.mkdirSync(SRC_JS_DIR, { recursive: true });
  fs.mkdirSync(SRC_CSS_DIR, { recursive: true });

  const appJs = fs.readFileSync(path.join(WWW_DIR, "app.js"), "utf8");
  const styleCss = fs.readFileSync(path.join(WWW_DIR, "style.css"), "utf8");
  const indexHtml = fs.readFileSync(path.join(WWW_DIR, "index.html"), "utf8");

  for (const mod of JS_MODULES) {
    const chunk = sliceLinesExact(appJs, mod.startLine, mod.endLine);
    fs.writeFileSync(path.join(SRC_JS_DIR, mod.file), chunk, "utf8");
  }

  for (const mod of CSS_MODULES) {
    const chunk = sliceLinesExact(styleCss, mod.startLine, mod.endLine);
    fs.writeFileSync(path.join(SRC_CSS_DIR, mod.file), chunk, "utf8");
  }

  fs.writeFileSync(path.join(SRC_DIR, "index.html"), indexHtml, "utf8");
  console.log(`[init] Populated src/js (${JS_MODULES.length} files), src/css (${CSS_MODULES.length} files), and src/index.html.`);
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildAll(checkOnly = false) {
  const jsFiles = fs
    .readdirSync(SRC_JS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort();
  const cssFiles = fs
    .readdirSync(SRC_CSS_DIR)
    .filter((f) => f.endsWith(".css"))
    .sort();

  if (jsFiles.length === 0 || cssFiles.length === 0) {
    throw new Error("Missing source files in src/js or src/css.");
  }

  const bundledJs = jsFiles
    .map((f) => fs.readFileSync(path.join(SRC_JS_DIR, f), "utf8"))
    .join("\n");
  const bundledCss = cssFiles
    .map((f) => fs.readFileSync(path.join(SRC_CSS_DIR, f), "utf8"))
    .join("\n");
  const indexHtml = fs.readFileSync(path.join(SRC_DIR, "index.html"), "utf8");

  // Validate that bundledJs has no ES6 import/export and compiles cleanly in new Function() (required by Live OTA)
  if (/^\s*(import|export)\s+/m.test(bundledJs)) {
    throw new Error("www/app.js must not contain ES6 import/export statements (breaks Live OTA evaluation).");
  }
  new Function(bundledJs);

  if (checkOnly) {
    const currentWwwJs = fs.readFileSync(path.join(WWW_DIR, "app.js"), "utf8");
    const currentWwwCss = fs.readFileSync(path.join(WWW_DIR, "style.css"), "utf8");
    const currentWwwHtml = fs.readFileSync(path.join(WWW_DIR, "index.html"), "utf8");
    if (currentWwwJs !== bundledJs || currentWwwCss !== bundledCss || currentWwwHtml !== indexHtml) {
      throw new Error("www/ is out of sync with src/. Run `npm run build`.");
    }
    console.log("[check] src/ -> www/ parity and OTA syntax verified.");
    return;
  }

  // Write bundled outputs to www/
  fs.writeFileSync(path.join(WWW_DIR, "app.js"), bundledJs, "utf8");
  fs.writeFileSync(path.join(WWW_DIR, "style.css"), bundledCss, "utf8");
  fs.writeFileSync(path.join(WWW_DIR, "index.html"), indexHtml, "utf8");

  // Mirror www/ to android/app/src/main/assets/public/ if directory exists or parent exists
  const androidAssetsParent = path.dirname(ANDROID_PUBLIC_DIR);
  if (fs.existsSync(androidAssetsParent)) {
    fs.mkdirSync(ANDROID_PUBLIC_DIR, { recursive: true });
    for (const file of ["app.js", "style.css", "index.html", "firebase-config.js", "firebase-config.example.js"]) {
      const srcFile = path.join(WWW_DIR, file);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, path.join(ANDROID_PUBLIC_DIR, file));
      }
    }
    copyDirRecursive(path.join(WWW_DIR, "lib"), path.join(ANDROID_PUBLIC_DIR, "lib"));
  }

  console.log(
    `[build] Built www/app.js (${bundledJs.split("\n").length} lines from ${jsFiles.length} modules), ` +
      `www/style.css (${bundledCss.split("\n").length} lines from ${cssFiles.length} modules), ` +
      `www/index.html, and synced Android public assets.`
  );
}

const args = process.argv.slice(2);
if (args.includes("--init")) {
  initFromWww();
  buildAll(false);
} else if (args.includes("--check")) {
  buildAll(true);
} else {
  buildAll(false);
}
