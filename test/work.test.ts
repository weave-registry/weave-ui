/** The `work` template, redesigned (docs/plans/2026-10-23-redesign-spec.md, "Work"): stats, the stage-column board, help, slots, other work. */
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

test("root: #view-work, polled, out of band; no nav count of its own", () => {
  const r = /^<section [^>]*>/.exec(full)?.[0] ?? "";
  for (const a of [`id="view-work"`, `class="view work"`, `hx-get="/ui/f/work"`, `hx-trigger="every 10s"`, `hx-swap="none"`, `hx-swap-oob="true"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.doesNotMatch(r, /data-nav-count/);
});

test("head: Work and the numbers — in progress, queued, merged today, slots busy", () => {
  assert.match(full, /<div class="page-head"><h1>Work<\/h1><div class="stats"><span><b>2<\/b> in progress<\/span><span><b>3<\/b> queued<\/span><span><b class="ok">1<\/b> merged today<\/span><span><b>2 \/ 4<\/b> slots busy<\/span><\/div><\/div>/);
});

test("board: seven stage columns, Triage to Merge, each with its count and its issue cards", () => {
  assert.match(full, /<section class="panel board" aria-label="Pipeline"><div class="board-cols">/);
  const cols = [...full.matchAll(/<div class="col" data-step="([a-z]+)"><div class="col-head"><span class="col-name">([A-Za-z]+)<\/span><span class="col-count num">(\d+)<\/span><\/div>/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
  assert.deepEqual(cols, ["triage:Triage:0", "design:Design:0", "plan:Plan:0", "build:Build:1", "verify:Verify:1", "review:Review:0", "merge:Merge:0"]);
  assert.match(full, /<div class="wcard" data-state="running"><div class="wcard-top"><span class="wcard-id num">#12<\/span><span class="state" data-state="running">Running<\/span><\/div><div class="wcard-title"><a href="https:\/\/git.local\/gary\/app\/issues\/12">Dark mode<\/a><\/div><div class="wcard-note">running on max \(dev\)<\/div><div class="wcard-foot"><a href="https:\/\/git.local\/gary\/app\/pulls\/40">PR #40<\/a><span class="wcard-age"><time [^>]*>[^<]*<\/time><\/span><\/div><\/div>/);
  assert.match(full, /<div class="wcard" data-state="held"><div class="wcard-top"><span class="wcard-id num">#13<\/span><span class="state" data-state="held">Held<\/span><\/div><div class="wcard-title">Held<\/div><div class="wcard-note">held — usage limit<\/div><div class="wcard-foot"><span>no PR<\/span>/);
  assert.match(live, /<div class="board-cols">.*<\/div><p class="empty">No issue is in the pipeline\.<\/p><\/section>/s);
});

test("where you can help: rows with why, the action and its alternatives, details and how", () => {
  assert.match(full, /<section class="panel" id="help" aria-labelledby="help-h"><div class="panel-head"><h2 id="help-h">Where you can help<\/h2><span class="pill" data-tone="needs">2<\/span><\/div><div class="lrows">/);
  assert.match(full, /<div class="lrow" data-key="g"><div class="lrow-main"><div class="lrow-title" title="Allow a command">Allow a command<\/div><div class="lrow-why">It runs outside the allow-list<\/div><\/div><div class="lrow-acts">/);
  assert.match(full, /hx-post="\/ui\/a\/grant" hx-swap="none"><input type="hidden" name="approve" value="g-9"><button class="btn primary" type="submit">Allow<\/button>/);
  assert.match(full, /data-confirm="Deny it\?"><input type="hidden" name="deny" value="g-9"><button class="btn" type="submit">Deny<\/button>/);
  assert.match(full, /<details class="lrow-more"><summary>Details<\/summary><pre>\$ rm -rf build<\/pre><\/details>/);
  assert.match(full, /<a class="btn primary" href="\/control">Open Control<\/a>/);
  assert.match(full, /<details class="lrow-more"><summary>How<\/summary><pre>weave secrets set FORGE_TOKEN<\/pre><\/details>/);
  assert.match(live, /<h2 id="help-h">Where you can help<\/h2><span class="pill" data-tone="ok">0<\/span><\/div><p class="empty">Nothing needs you\.<\/p>/);
});

test("who is working: a slot strip per machine (busy cells carry the task), the tasks linked, paused and silent agents said", () => {
  assert.match(full, /<section class="panel" id="who" aria-labelledby="who-h"><div class="panel-head"><h2 id="who-h">Who is working<\/h2><span class="panel-link">2 of 4 slots busy<\/span><\/div>/);
  assert.match(full, /<div class="slot-host" data-quiet="false"><div class="slot-head"><span class="dot" data-tone="ok"><\/span><b>max<\/b><span class="muted">2 \/ 2<\/span><\/div><div class="slots">/);
  assert.equal((full.match(/<span class="slot"( data-busy="true" title="[^"]*")?><\/span>/g) ?? []).length, 4, "one cell per agent slot");
  assert.equal((full.match(/<span class="slot" data-busy="true"/g) ?? []).length, 2);
  assert.match(full, /<span class="slot" data-busy="true" title="building #12 “Dark mode”"><\/span>/);
  assert.match(full, /<div class="slot-doing"><a href="\/task\?id=t-1">building #12 “Dark mode”<\/a> <span class="muted">dev · Sonnet · <time [^>]*data-fmt="dur"/);
  assert.ok(full.includes("p: Paused — paused by gary"));
  assert.ok(full.includes("x: Silent"));
  assert.match(full, /<div class="slot-host" data-quiet="true"><div class="slot-head"><span class="dot" data-tone="bad"><\/span><b>mini<\/b><span class="muted">Not heard from since <time/);
  assert.match(live, /<span class="dot" data-tone="ok"><\/span>/);
});

test("other work: task rows linked, and the rest counted", () => {
  assert.match(full, /<section class="panel" id="other" aria-labelledby="other-h"><div class="panel-head"><h2 id="other-h">Other work<\/h2>/);
  assert.match(full, /<a href="\/task\?id=t-9">Summarise the log<\/a>/);
  assert.match(full, /<p class="empty"><a href="\/audit\?since=24h">and 4 more<\/a><\/p>/);
});
