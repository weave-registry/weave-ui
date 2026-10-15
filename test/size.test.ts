/** The production build's size budget (ADR-0234 §7). weave's own caps: 16 MiB of assets, 2 MiB per render. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { DIST, walk } from "./helpers.js";

const KiB = 1024;
const BUDGET = { templates: 192 * KiB, assets: 160 * KiB, total: 320 * KiB } as const;

test(`size budget: templates.js ≤ ${BUDGET.templates / KiB} KiB, assets ≤ ${BUDGET.assets / KiB} KiB, total ≤ ${BUDGET.total / KiB} KiB`, () => {
  const t = statSync(join(DIST, "templates.js")).size;
  const a = walk(join(DIST, "assets")).reduce((n, p) => n + statSync(join(DIST, "assets", p)).size, 0);
  const m = statSync(join(DIST, "manifest.json")).size;
  const report = `templates.js ${t} B · assets ${a} B · manifest ${m} B · total ${t + a + m} B`;
  console.log(report);
  assert.ok(t <= BUDGET.templates, report);
  assert.ok(a <= BUDGET.assets, report);
  assert.ok(t + a + m <= BUDGET.total, report);
});
