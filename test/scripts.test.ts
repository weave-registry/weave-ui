// The `test` script is what CI runs (`bun run test`). Every test directory must be in its glob, or its tests
// exist on disk and never run — the defect found in review of #8 (test/server/*.test.ts was never globbed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.js";

const root = ROOT;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };

test("the test script globs every test directory that holds *.test.ts files", () => {
  const script = pkg.scripts["test"] ?? "";
  const dirs = ["test", ...readdirSync(join(root, "test"))
    .filter((d) => statSync(join(root, "test", d)).isDirectory())
    .map((d) => `test/${d}`)];
  for (const dir of dirs) {
    const hasTests = readdirSync(join(root, dir)).some((f) => f.endsWith(".test.ts"));
    if (!hasTests) continue;
    assert.ok(script.includes(`${dir}/*.test.ts`), `package.json "test" does not run ${dir}/*.test.ts: ${script}`);
  }
});
