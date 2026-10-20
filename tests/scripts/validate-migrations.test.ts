/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/validate-migrations.mjs");

function run(dir?: string) {
  return spawnSync("node", dir ? [SCRIPT, dir] : [SCRIPT], { encoding: "utf8" });
}

function tempDirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "migrations-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

describe("validate-migrations script", () => {
  it("accepts the repository's real migrations", () => {
    const res = run();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Migration validation OK/);
  });

  it("rejects a badly named migration file", () => {
    const dir = tempDirWith({ "add-things.sql": "select 1;" });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/filename must be/);
  });

  it("rejects duplicate timestamps", () => {
    const dir = tempDirWith({
      "20260101000000_first.sql": "select 1;",
      "20260101000000_second.sql": "select 2;",
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/duplicate migration timestamp/);
  });

  it("rejects an empty migration file", () => {
    const dir = tempDirWith({ "20260101000000_empty.sql": "   \n" });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/file is empty/);
  });
});
