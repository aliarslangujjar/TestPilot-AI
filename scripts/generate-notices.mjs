/**
 * Regenerates THIRD_PARTY_NOTICES.md from the installed dependency
 * tree: every production dependency of the root package (the web app
 * and the worker share one manifest), with its license as declared in
 * its own package.json.
 *
 *   node scripts/generate-notices.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dependencyNames = Object.keys(manifest.dependencies ?? {}).sort();

function readInstalled(name) {
  const path = join(root, "node_modules", name, "package.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

const rows = [];
const missing = [];
for (const name of dependencyNames) {
  const pkg = readInstalled(name);
  if (!pkg) {
    missing.push(name);
    continue;
  }
  const license =
    typeof pkg.license === "string"
      ? pkg.license
      : (pkg.license?.type ??
        (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(", ") : "SEE PACKAGE"));
  const author = typeof pkg.author === "string" ? pkg.author : (pkg.author?.name ?? "");
  rows.push({ name, version: pkg.version ?? "?", license, author });
}

const lines = [
  "# Third-Party Notices",
  "",
  "TestPilot AI is MIT-licensed (see LICENSE.md). It builds on the",
  "open-source packages below — the direct production dependencies of",
  "the root `package.json` (the web app and the Playwright worker",
  "share one manifest), each listed with the license declared in its",
  "own package.json. Transitive dependencies are covered by their own",
  "packages' license files in `node_modules`.",
  "",
  "Regenerate with `node scripts/generate-notices.mjs` after dependency",
  "changes.",
  "",
  "| Package | Version | License | Author |",
  "| ------- | ------- | ------- | ------ |",
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} | ${r.author} |`),
  "",
];

if (missing.length > 0) {
  lines.push(`> Not installed when this file was generated: ${missing.join(", ")}.`, "");
}

writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), lines.join("\n"));
console.log(`Wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages.`);
