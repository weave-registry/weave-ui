/** The `task` template at parity with weave's task story (/task?id=; docs/parity/task-audit.md, ## Task detail). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { CTX, ROOT } from "./helpers.js";

const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));
const task = (vm: unknown): string => (templates as Record<string, (v: unknown, c: unknown) => string>).task!(vm, CTX);
const working = task(fx("task.working"));
const done = task(fx("task.live"));
const failed = task(fx("task.failed"));

test("root: #view-task re-reads itself by id, out of band", () => {
  const r = /^<section [^>]*>/.exec(working)?.[0] ?? "";
  for (const a of [`id="view-task"`, `hx-get="/ui/f/task?id=task-w1"`, `hx-trigger="every 10s"`, `hx-swap="none"`, `hx-swap-oob="true"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.match(working, /<h1>Fix the flaky test<\/h1>/);
});

test("status sentence by state", () => {
  assert.match(working, /<div class="status" data-tone="work">Being worked on by max-dev<\/div>/);
  assert.match(done, /<div class="status" data-tone="ok">Done in /);
  assert.match(failed, /<div class="status" data-tone="bad">Failed<\/div>/);
});

test("actions: Stop while running, the full record, grants", () => {
  assert.match(working, /data-confirm="Stop &quot;Fix the flaky test&quot;\? The worker aborts; what it did so far is kept\."><input type="hidden" name="@" value="task-w1"><button class="btn danger" type="submit">Stop<\/button>/);
  assert.doesNotMatch(done, /\/ui\/a\/cancel/);
  assert.match(working, /<a class="btn" href="\/audit\?id=task-w1">Full record<\/a>/);
  assert.ok(working.includes("It wants to use bash"));
  assert.match(working, /<input type="hidden" name="approve" value="g-7"><button class="btn primary" type="submit">Allow<\/button>/);
});

test("result as markdown, files, what was asked folded after 8 lines, details", () => {
  assert.match(working, /<h2 class="section">Result<\/h2><div class="card md"><h4>Partial<\/h4>/);
  assert.match(failed, /<h2 class="section">Why it failed<\/h2><div class="card md"><p>Exit 1: <strong>boom<\/strong><\/p>/);
  assert.match(working, /<a href="\/file\?path=%2Fwork%2Fout%2Freport\.md" target="_blank" rel="noopener" title="\/work\/out\/report\.md">report\.md<\/a>/);
  assert.match(working, /<details><summary>Show the whole request<\/summary><p class="text">line 9\nline 10\nline 11\nline 12<\/p><\/details>/);
  assert.match(working, /<dt>Worker<\/dt><dd>max-dev<\/dd>/);
  assert.match(working, /<dt>Cost<\/dt><dd>&lt;\$0\.01<\/dd>/);
  assert.match(working, /<dt>Started by<\/dt><dd><a href="\/task\?id=task-p0">the task that spawned it<\/a><\/dd>/);
  assert.doesNotMatch(done, /<dt>Cost<\/dt>/);
});
