/** weave refuses a bundle whose templates.js names any impure token — anywhere, string literals included. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPURE_TOKENS, impurity } from "../vendor/weave/purity.js";
import { DIST } from "./helpers.js";

test("the copied scan carries weave's fifteen tokens (c4e6e3a7)", () => {
  assert.deepEqual([...IMPURE_TOKENS], [
    "import", "require(", "process", "globalThis", "eval", "Function(", "fetch", "XMLHttpRequest", "WebSocket",
    "Atomics", "SharedArrayBuffer", "Promise", "async", "await", "FinalizationRegistry",
  ]);
  assert.deepEqual(impurity("var templates = {};\nvar s = 'we process it';"), { token: "process", line: 2 });
  assert.equal(impurity("var templates = { important: 1, evaluation: 2 };"), null);
});

test("the built templates.js passes weave's purity scan", () => {
  const src = readFileSync(join(DIST, "templates.js"), "utf8");
  const hit = impurity(src);
  assert.equal(hit, null, hit ? `templates.js line ${hit.line} uses ${hit.token}: ${src.split("\n")[hit.line - 1]?.slice(0, 160)}` : "");
});
