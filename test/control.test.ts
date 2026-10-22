/** The `control` template at parity with weave's Control page (docs/parity/home-work-control.md, ## Control). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { CTX, ROOT } from "./helpers.js";

const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));
const control = (vm: unknown): string => (templates as Record<string, (v: unknown, c: unknown) => string>).control!(vm, CTX);
const full = control(fx("control.full"));
const live = control(fx("control.live"));

test("root: #view-control, polled, out of band", () => {
  const r = /^<section [^>]*>/.exec(full)?.[0] ?? "";
  for (const a of [`id="view-control"`, `hx-get="/ui/f/control"`, `hx-trigger="every 15s"`, `hx-swap="none"`, `hx-swap-oob="true"`]) assert.ok(r.includes(a), `${a} in ${r}`);
});

test("head: Control and its summary line", () => {
  assert.match(full, /<h1>Control<\/h1>/);
  assert.match(full, /Halted · budget \$25\.00 \(log\) · \$26\.50 spent in 24h · 9 tasks in 24h\./);
  assert.match(live, /Running · budget \$25\.00 \(startup\)/);
});

test("control plane: budget with its source, halt with who and Resume, autonomy and guard, config", () => {
  assert.ok(full.includes("$25.00 per 24h · set on the log by gary"));
  assert.ok(live.includes("startup default (no budget.set on the log)"));
  assert.match(full, /Halted \(drain\)/);
  assert.ok(full.includes("budget · over budget"));
  assert.ok(full.includes("gary@bazzite · pid 123 · gateway"));
  // ADR-0245 §3: halt and resume are `weave halt` / `weave resume`, shown as text — the console credential may not.
  assert.match(full, /<div class="actions"><span class="cli">Resume from the command line: <code>weave resume<\/code><\/span><\/div>/);
  assert.doesNotMatch(full, /\/ui\/a\/fleet/);
  assert.ok(live.includes("Not halted — peers claim normally."));
  assert.ok(full.includes("strict · set by gary"));
  assert.match(full, /<td><code>model\.default<\/code><\/td><td><code>opus<\/code><\/td>/);
  assert.match(full, /<code>\{&quot;a&quot;:1\}<\/code>/);
  assert.match(full, /<p class="unavail">2 of 5<\/p>/);
});

test("peers: behind, settling, gateways", () => {
  assert.ok(full.includes("1 of 2 behind the log — peers and gateways"));
  assert.match(full, /<span class="badge" data-tone="bad">behind<\/span>/);
  assert.match(full, /<span class="badge" data-tone="needs">settling<\/span>/);
  assert.ok(full.includes("budget 20 vs 25"));
});

test("raft: summary, silent and frozen cards, voters table", () => {
  assert.ok(full.includes("Raft control plane (shadow): 1 of 2 voters diverge"));
  assert.ok(full.includes("Silent: mini"));
  assert.ok(full.includes("no quorum: control frozen"));
  assert.match(full, /<strong>max<\/strong> <span class="badge" data-tone="needs">stale<\/span>/);
  assert.ok(full.includes("diverges for 30s"));
  assert.match(live, /<p class="unavail" role="status"><strong>no live peer reports a Raft voter/);
});

test("models: usage limit, by-model line, tasks, model settings, hosts", () => {
  assert.ok(full.includes("Claude account at its usage limit"));
  assert.ok(full.includes("weave plugin enable openrouter"));
  assert.match(full, /<strong>opus<\/strong> 3 tasks/);
  assert.match(full, /<a href="\/task\?id=task-1">Fix it<\/a>/);
  assert.match(full, /<a href="\/task\?id=task-2">task-2<\/a>/);
  assert.ok(full.includes("failover:usage-limit"));
  assert.ok(full.includes("Model settings on bazzite:8788"));
  assert.match(full, /<span class="badge" data-tone="bad">claude · 429<\/span>/);
  assert.match(full, /<span class="unavail">lanes unknown<\/span>/);
});

test("costs: the big number, the meter, by model/peer/task", () => {
  assert.match(full, /<span class="big">\$26\.50<\/span>/);
  assert.ok(full.includes("of $25.00 in the last 24h (100%)"));
  assert.match(full, /<meter [^>]*value="100"[^>]*data-tone="bad"/);
  assert.ok(full.includes("Per-task ceiling: $2.00"));
  assert.ok(full.includes("Same figures as weave spend"));
  assert.match(full, /<a href="\/task\?id=task-1">Fix it<\/a>/);
  assert.ok(full.includes("max-peer"));
});
