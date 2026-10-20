/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Boundary guard: browser execution must NEVER happen inside the web
 * app (and therefore never inside a Vercel request handler). The web
 * app only enqueues job rows; the standalone worker executes them.
 * This test fails if any app-side module imports Playwright or the
 * worker's code.
 */

const FORBIDDEN =
  /(?:from\s+|require\(\s*|import\s*\(\s*)["'](?:playwright(?:\/.*)?|workers\/playwright(?:\/.*)?|@\/workers(?:\/.*)?)["']/;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      yield path;
    }
  }
}

describe("Vercel boundary — no browser execution in the web app", () => {
  it("no app/lib/components module imports playwright or worker code", () => {
    const offenders: string[] = [];
    for (const root of ["app", "lib", "components"]) {
      for (const file of sourceFiles(join(process.cwd(), root))) {
        const content = readFileSync(file, "utf8");
        if (FORBIDDEN.test(content)) offenders.push(file);
      }
    }
    for (const file of ["proxy.ts", "instrumentation.ts", "next.config.ts"]) {
      const content = readFileSync(join(process.cwd(), file), "utf8");
      if (FORBIDDEN.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
