#!/usr/bin/env node
/**
 * Migration validation that is practical without a database:
 *   - every file is named <14-digit timestamp>_<snake_case>.sql
 *   - timestamps are unique (two migrations can never race for order)
 *   - files sort ascending by name (application order = name order)
 *   - no file is empty
 *
 * It does NOT lint SQL semantics — applying migrations to a real
 * Postgres (local `supabase migration up`) remains the semantic check.
 *
 * Usage: node scripts/validate-migrations.mjs [migrationsDir]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? process.env.MIGRATIONS_DIR ?? "supabase/migrations";
const NAME = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

let files;
try {
  files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
} catch {
  console.error(`Migration validation failed: cannot read directory ${dir}`);
  process.exit(1);
}

const errors = [];
const seen = new Set();
for (const file of files) {
  const match = NAME.exec(file);
  if (!match) {
    errors.push(`${file}: filename must be <14-digit timestamp>_<snake_case>.sql`);
    continue;
  }
  const timestamp = match[1];
  if (seen.has(timestamp)) {
    errors.push(`${file}: duplicate migration timestamp ${timestamp}`);
  }
  seen.add(timestamp);
  const body = readFileSync(join(dir, file), "utf8").trim();
  if (body.length === 0) {
    errors.push(`${file}: file is empty`);
  }
}

if (errors.length > 0) {
  console.error("Migration validation failed:");
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(
  `Migration validation OK: ${files.length} migrations, unique ordered timestamps, none empty.`,
);
