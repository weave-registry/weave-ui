/** The `work` template at parity with weave's Work page (docs/parity/home-work-control.md, ## Work). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { CTX, ROOT } from "./helpers.js";

const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));
const work = (vm: unknown): string => (templates as Record<string, (v: unknown, c: unknown) => string>).work!(vm, CTX);
const full = work(fx("work.full"));
const live = work(fx("work.live"));

test("root: #view-work, polled, out of band, carries the Work nav count", () => {
  const r = /^<section [^>]*>/.exec(full)?.[0] ?? "";
  for (const a of [`id="view-work"`, `hx-get="/ui/f/work"`, `hx-trigger="every 10s"`, `hx-swap="none"`, `hx-swap-oob="true"`, `data-nav-count="work:2"`]) assert.ok(r.includes(a), `${a} in ${r}`);
});

test("head: Work and the summary sentence", () => {
  assert.match(full, /<h1>Work<\/h1>/);
  assert.ok(full.includes("2 of 4 slots in use on 2 machines"));
});

test("who is working: machines, slots, agents with what they do", () => {
  assert.match(full, /Who is working<span class="count"> \(2 of 4 slots in use\)<\/span>/);
  assert.ok(full.includes("2 of 2 slots in use"));
  assert.match(full, /<a href="\/task\?id=t-1">building #12 “Dark mode”<\/a>/);
  assert.ok(full.includes(", Sonnet)"));
  assert.match(full, /Not heard from since <time/);
  assert.ok(full.includes("Paused — paused by gary"));
  assert.ok(full.includes("Silent"));
  assert.match(full, /class="status" data-tone="work"/);
  assert.match(live, /data-tone="ok"/);
});

test("what is left: counts, issues with the step line and links, other work", () => {
  assert.ok(full.includes("2 issues in progress · 3 steps queued · 1 merged today"));
  assert.match(full, /<strong>Dark mode<\/strong>/);
  assert.match(full, /<a class="btn link" href="https:\/\/git.local\/gary\/app\/issues\/12" target="_blank" rel="noopener noreferrer">Issue<\/a>/);
  assert.match(full, />Pull request #40<\/a>/);
  assert.match(full, /<ol class="line">/);
  assert.match(full, /<li data-state="current" data-tone="work" title="current">Build<\/li>/);
  assert.match(full, /<li data-state="skipped" data-tone="" title="skipped">Design<\/li>/);
  assert.match(full, /data-tone="bad"[^>]*>Verify: held — usage limit · <time/);
  assert.match(full, /<a href="\/task\?id=t-9">Summarise the log<\/a>/);
  assert.ok(full.includes("and 4 more — see Activity."));
  assert.match(live, /No issue is in the pipeline\./);
});

test("where you can help: why, detail, the action and its alternatives, how", () => {
  assert.match(full, /Where you can help<span class="count"> \(2\)<\/span>/);
  assert.ok(full.includes("Why you: It runs outside the allow-list"));
  assert.match(full, /<pre>\$ rm -rf build<\/pre>/);
  assert.match(full, /hx-post="\/ui\/a\/grant" hx-swap="none"><input type="hidden" name="approve" value="g-9"><button class="btn primary" type="submit">Allow<\/button>/);
  assert.match(full, /data-confirm="Deny it\?"><input type="hidden" name="deny" value="g-9"><button class="btn" type="submit">Deny<\/button>/);
  assert.match(full, /<a class="btn primary" href="\/control">Open Control<\/a>/);
  assert.match(full, /<details class="fix"><summary>How<\/summary><pre>weave secrets set FORGE_TOKEN<\/pre><\/details>/);
  assert.match(live, /Nothing needs you\./);
});
