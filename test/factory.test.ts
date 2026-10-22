/** The `factory` template at parity with weave's Factory page (docs/parity/factory-machines-team.md, ## Factory). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { CTX, ROOT } from "./helpers.js";

const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));
const factory = (vm: unknown): string => (templates as Record<string, (v: unknown, c: unknown) => string>).factory!(vm, CTX);
const full = factory(fx("factory.full"));
const yolo = factory(fx("factory.yolo"));
const live = factory(fx("factory.live"));

test("root: #view-factory, polled, out of band; the sidebar's Factory value comes from Home, not from here", () => {
  const r = /^<section [^>]*>/.exec(full)?.[0] ?? "";
  for (const a of [`id="view-factory"`, `hx-get="/ui/f/factory"`, `hx-trigger="every 10s"`, `hx-swap="none"`, `hx-swap-oob="true"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.doesNotMatch(r, /data-nav-count/);
});

test("head: the numbers row — in the pipeline, need you, completed, in the backlog", () => {
  assert.match(full, /<div class="page-head"><h1>Factory<\/h1><div class="stats"><span><b>2<\/b> in the pipeline<\/span><span><b class="needs">2<\/b> need you<\/span><span><b class="ok">1<\/b> completed<\/span><span><b>2<\/b> in the backlog<\/span><\/div><\/div>/);
  assert.match(live, /<div class="page-head"><h1>Factory<\/h1><div class="stats"><span><b>0<\/b> in the pipeline<\/span><span><b>0<\/b> need you<\/span>/);
});

test("head and yolo card: off with why, the duration picker; on with time left and Turn off", () => {
  assert.match(full, /<h1>Factory<\/h1>/);
  assert.match(full, /<details class="more"><summary>What yolo does<\/summary>/);
  assert.match(full, /Yolo mode/);
  assert.match(full, /Off — it expired <time/);
  assert.match(full, /<select name="for" class="yolo-pick" aria-label="For how long">/);
  assert.match(full, /hx-post="\/ui\/a\/yolo"[^>]*><input type="hidden" name="on:bool" value="true">/);
  assert.match(yolo, /On — <time[^>]*data-fmt="until"[^>]*>.*<\/time> left · turned on by gary via console: weekend/);
  assert.match(yolo, /<input type="hidden" name="off:bool" value="true"><button class="btn primary" type="submit">Turn yolo off<\/button>/);
  assert.ok(full.includes("While it is on, the factory advances and re-runs stages"));
});

test("supervisor: status, decisions with their actions, in hand, recent advances", () => {
  assert.ok(full.includes("Off — each stage waits for you to press Advance."));
  assert.ok(full.includes("2 decisions for you"));
  assert.match(full, /hx-post="\/ui\/a\/factoryDecide" hx-swap="none"><input type="hidden" name="key" value="merge:40"><input type="hidden" name="label" value="merge">/);
  assert.match(full, /data-confirm="Close #12\? Its open stages are cancelled, and an issue on the forge is closed there\."/);
  assert.match(full, /<details class="fix"><summary>How to fix<\/summary><pre>weave factory unstick 13<\/pre><\/details>/);
  assert.match(full, /<summary>In hand \(1\)<\/summary>/);
  assert.match(full, /<summary>Recent advances \(2\)<\/summary>/);
  assert.ok(full.includes("#13 → plan — failed: no slot"));
  assert.ok(yolo.includes("Waiting — the model&#39;s usage limit is reached (usage limit until 18:00)"));
  assert.ok(live.includes("Nothing needs you."));
});

test("start new work: title and details post factoryNew", () => {
  assert.match(full, /<form class="card" id="new-form" hx-post="\/ui\/a\/factoryNew" hx-swap="none">/);
  assert.match(full, /<input name="title" maxlength="200" aria-label="Title"[^>]*required>/);
  assert.match(full, /<textarea name="body" rows="3" maxlength="8000" aria-label="Details"/);
});

test("backlog: Start sends the issue to triage with its title, url and repo", () => {
  assert.match(full, /<summary>Backlog — not started \(2\)<\/summary>/);
  assert.match(full, /hx-post="\/ui\/a\/factory" hx-swap="none"><input type="hidden" name="issue:num" value="20"><input type="hidden" name="stage" value="triage"><input type="hidden" name="title" value="New idea"><input type="hidden" name="url" value="https:\/\/git.local\/gary\/app\/issues\/20"><input type="hidden" name="repo" value="gary\/app">/);
  assert.doesNotMatch(full, /name="url" value=""/);
});

test("issues: needs-you first, approvals, start, the trail, footer, completed", () => {
  assert.match(full, /Issues<span class="count"> \(2 need you\)<\/span>/);
  assert.ok(full.includes("2 issues need you — they&#39;re first below."));
  assert.ok(full.indexOf("#12 Dark mode") < full.indexOf("#13 Typo"));
  assert.ok(full.includes("Waiting for you — Build needs your approval"));
  assert.ok(full.includes("Build wants to run a command"));
  assert.match(full, /<pre>bun test<\/pre>/);
  assert.match(full, /<input type="hidden" name="approve" value="gr-1"><button class="btn primary" type="submit">Allow<\/button>/);
  assert.match(full, /<span class="chip" data-tone="bad">1 failed<\/span>/);
  assert.match(full, /hx-post="\/ui\/a\/factoryAdvance" hx-swap="none"><input type="hidden" name="issue:num" value="13"><button class="btn primary" type="submit">Start Plan<\/button>/);
  assert.ok(full.includes("Build — queued, waiting for a free slot"));
  assert.match(full, /<li class="step" data-state="running"[^>]*>Build …<span class="model"> sonnet 5 ↑ from qwen3:8b<\/span><\/li>/);
  assert.match(full, /<a href="\/audit\?thread=factory:12">History<\/a>/);
  assert.ok(full.includes("spent $1.25 + hexa $0.50"));
  assert.match(full, /<summary>Completed \(1\)<\/summary>/);
  assert.ok(live.includes("No work yet."));
});
