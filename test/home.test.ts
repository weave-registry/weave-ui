/** The `home` template at parity with weave's Home (docs/parity/home-work-control.md, ## Home). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { CTX, ROOT } from "./helpers.js";

const fx = (n: string): Record<string, unknown> => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8")) as Record<string, unknown>;
const home = (vm: unknown): string => (templates as Record<string, (v: unknown, c: unknown) => string>).home!(vm, CTX);
const full = home(fx("home.full"));
const live = home(fx("home.live"));
const rootTag = (h: string): string => /^<section [^>]*>/.exec(h)?.[0] ?? "";

test("root: #view-home swaps out of band, polls itself, carries the needs-you and Work counts", () => {
  const r = rootTag(full);
  for (const a of [`id="view-home"`, `hx-get="/ui/f/home"`, `hx-trigger="every 10s"`, `hx-swap="none"`, `hx-swap-oob="true"`, `data-needs-count="7"`, `data-nav-count="work:0"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.ok(rootTag(live).includes(`data-needs-count="0"`));
});

test("head: Home, the brief, and Work's sentence linking to /work", () => {
  assert.match(full, /<h1>Home<\/h1>/);
  assert.ok(full.includes("Good evening. Nothing needs you"));
  assert.match(full, /<a href="\/work">Open Work<\/a>/);
});

test("harness panel: verdict, word, sentence, reasons with their fixes", () => {
  assert.match(full, /<div class="harness" data-verdict="degraded" role="status" aria-label="Harness status">/);
  assert.match(full, /DEGRADED/);
  assert.ok(full.includes("Working, but a host is down."));
  assert.match(full, /hx-post="\/ui\/a\/fleet"[^>]*data-confirm="Resume the fleet\?"><input type="hidden" name="@" value="resume">/);
  assert.match(full, /hx-post="\/ui\/a\/yolo"[^>]*data-confirm="Turn yolo on\?"/);
  assert.match(full, /<select name="for"[^>]*>.*<option value="8h" selected>8 hours<\/option>/s);
  assert.match(full, /name="on:bool" value="true"/);
  assert.match(full, /<a class="btn" href="#needs-h">See them<\/a>/);
});

test("harness facts in weave's words, the spend meter as <meter>", () => {
  for (const s of ["1 of 2 hosts up", "not heard: max", "32 cores", "1 agent live", "0 running · 0 queued · 3 done · 0 failed in 24h", "Spend $23.40 of $25", "Yolo on", "Chief of staff on · 4 acts in the last hour", "autonomy: full — 1 merge in 8h of cap 3", "factory: 0.5 retries per stage (24h)", "control plane: 1 of 2 peers behind — max-peer (budget)", "1 breaker open", "model.default differs", "Claude account at its usage limit", "failing over to openrouter", "Raft control plane (shadow)", "Needs you: ", "Reconciled ", "3 issues not started on the forge", "27 open decisions"]) {
    assert.ok(full.includes(s), `missing fact: ${s}`);
  }
  assert.match(full, /<meter [^>]*value="94"[^>]*>/);
  assert.match(full, /<a href="\/control">Control plane, models and costs →<\/a>/);
});

test("the fleet's halt and yolo controls ride on Home (weave's topbar, from the harness)", () => {
  assert.match(live, /hx-post="\/ui\/a\/fleet"[^>]*data-confirm="Halt the fleet\? Every worker stops what it is doing and takes nothing new until you resume\. Yolo mode ends\."><input type="hidden" name="@" value="halt">/);
  assert.match(full, /hx-post="\/ui\/a\/yolo"[^>]*><input type="hidden" name="off:bool" value="true">/);
});

test("needs you: heading with its count, grants Allow/Deny with the countdown", () => {
  assert.match(full, /<h2 class="section" id="needs-h">Needs you<span class="count"> \(7\)<\/span><\/h2>/);
  assert.ok(full.includes("Fix the flaky test wants to run a command"));
  assert.match(full, /<pre>\$ bun run test\nin \/work\/repo<\/pre>/);
  assert.match(full, /hx-post="\/ui\/a\/grant" hx-swap="none"><input type="hidden" name="approve" value="g-1"><button class="btn primary" type="submit">Allow<\/button>/);
  assert.match(full, /<input type="hidden" name="deny" value="g-1"><button class="btn" type="submit">Deny<\/button>/);
  assert.match(full, /data-fmt="until"/);
  assert.ok(full.includes("wants to use hexa (build) — this spends Claude credits"));
  assert.match(live, /Nothing needs you right now\./);
});

test("needs you: a stage card starts or closes the issue", () => {
  assert.ok(full.includes("ready for Build"));
  assert.ok(full.includes("Build will make the change. The last stage said: plan written, test committed"));
  assert.match(full, /hx-post="\/ui\/a\/factoryAdvance" hx-swap="none"><input type="hidden" name="issue:num" value="12"><button class="btn primary" type="submit">Start Build<\/button>/);
  assert.match(full, /hx-post="\/ui\/a\/factoryClose"[^>]*data-confirm="Close #12\? Its open stages are cancelled, and an issue on the forge is closed there\."/);
  assert.match(full, /<a class="btn link" href="\/factory">Open Factory<\/a>/);
});

test("needs you: a plan is ticked — steps checked, roles not — and accepted or declined", () => {
  assert.ok(full.includes("The chief of staff proposes: Two steps and a new role"));
  assert.match(full, /<a href="\/task\?id=task-71de9ec3">Ship the release notes<\/a>/);
  assert.match(full, /<input type="hidden" name="accept" value="p-1">/);
  assert.match(full, /<input type="checkbox" name="steps:num\[\]" value="0" checked>/);
  assert.match(full, /<input type="checkbox" name="steps:num\[\]" value="1" checked>/);
  assert.match(full, /<input type="checkbox" name="roles:str\[\]" value="copywriter">/);
  assert.match(full, /about \$0\.42/);
  assert.match(full, />Start ticked<\/button>/);
  assert.match(full, /<input type="hidden" name="decline" value="p-1"><button class="btn" type="submit">Decline<\/button>/);
});

test("needs you: halt offers Resume and a new budget", () => {
  assert.match(full, /<input type="hidden" name="@" value="resume"><button class="btn primary" type="submit">Resume<\/button>/);
  assert.match(full, /hx-post="\/ui\/a\/budget"[^>]*><input type="number" name="usd:num" min="0" step="5" placeholder="\$ per day" aria-label="New budget in dollars per day" required><button class="btn" type="submit">Raise budget<\/button>/);
});

test("needs you: attention items — who decides, actions, how to fix", () => {
  assert.match(full, /<p class="card-who" data-tone="auto">Yolo will decide this in 2h<\/p>/);
  assert.match(full, /<input type="hidden" name="approve:bool" value="true">/);
  assert.match(full, /<a class="btn" href="https:\/\/git.local\/gary\/weave\/pulls\/567" target="_blank" rel="noopener noreferrer">Open PR<\/a>/);
  assert.match(full, /<details class="fix"><summary>Details<\/summary><pre>weave release merge 0\.2\.181<\/pre><\/details>/);
  assert.match(full, /<details class="fix"><summary>How to fix<\/summary><pre>weave peers<\/pre><\/details>/);
});

test("decided for you, working now, done recently", () => {
  assert.match(full, /Decided for you<span class="count"> \(2\)<\/span>/);
  assert.match(full, /<span class="badge" data-tone="auto">yolo<\/span>/);
  assert.match(full, /<a href="\/audit\?id=release-0\.2\.179">Audit<\/a>/);
  assert.match(live, /Nothing was decided for you in the last 24 hours\./);
  assert.match(full, /<a href="\/task\?id=task-aa">Fix the flaky test<\/a>/);
  assert.match(full, /hx-post="\/ui\/a\/cancel"[^>]*data-confirm="Stop &quot;Fix the flaky test&quot;\? The worker aborts; what it did so far is kept\."><input type="hidden" name="@" value="task-aa">/);
  assert.match(full, /2 tasks waiting for a worker\./);
  assert.match(live, /Nothing is running\./);
  assert.match(full, /<span class="mark" data-state="failed">✗<\/span>/);
  assert.ok(full.includes("Failed: exit 1"));
  assert.match(full, /<span class="mark" data-state="cancelled">–<\/span>/);
});

test("ask weave: turns, markdown answers, panels, files, progress; the composer and New conversation", () => {
  assert.match(full, /<aside class="chat" id="chat-panel"/);
  assert.match(full, /<h4>Done<\/h4>/);
  assert.match(full, /<strong>one<\/strong>/);
  assert.match(full, /<a href="\/file\?path=%2Fwork%2Freports%2Fdash\.md" target="_blank" rel="noopener" title="\/work\/reports\/dash\.md">dash\.md<\/a>/);
  assert.match(full, /<div class="metrics">/);
  assert.match(full, /Working on it/);
  assert.match(full, /<li>reading the log<\/li>/);
  assert.match(full, /Waiting for a worker…/);
  assert.match(full, /That didn&#39;t work\./);
  assert.match(full, /<form class="composer" hx-post="\/ui\/a\/chat" hx-swap="none"><textarea name="text" [^>]*data-enter-submits[^>]*><\/textarea>/);
  assert.match(full, /hx-post="\/ui\/a\/chat"[^>]*data-confirm="Start a new conversation\? Weave stops carrying this one into its answers; it stays in the record\."><input type="hidden" name="reset:bool" value="true"><button class="btn link" type="submit">New conversation<\/button>/);
});
