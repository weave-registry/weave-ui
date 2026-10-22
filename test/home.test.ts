/**
 * The `home` template, redesigned (docs/plans/2026-10-23-redesign.md; markup in docs/plans/2026-10-23-redesign-spec.md):
 * the health banner, the KPI strip, Needs you as dense rows with filter chips, the side column (machines, autonomy,
 * control plane), the lower row (working, done, decided, Ask weave), and the out-of-band sidebar fragments.
 */
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
const halted = home(fx("home.halted"));
const rootTag = (h: string): string => /^<section [^>]*>/.exec(h)?.[0] ?? "";
/** The #view-home section alone (the out-of-band sidebar fragments follow it). */
const section = (h: string): string => h.slice(0, h.indexOf("</section>", h.lastIndexOf('id="chat-panel"')) + "</section>".length);
const oob = (h: string, id: string): string => new RegExp(`<([a-z]+) id="${id}" hx-swap-oob="innerHTML">([\\s\\S]*?)</\\1>(?=<[a-z]+ id="|$)`).exec(h)?.[2] ?? "<missing>";

test("root: #view-home swaps out of band, polls itself, carries the needs-you count; no nav count of its own", () => {
  const r = rootTag(full);
  for (const a of [`id="view-home"`, `class="view home"`, `hx-get="/ui/f/home"`, `hx-trigger="every 10s"`, `hx-swap="none"`, `hx-swap-oob="true"`, `data-needs-count="7"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.doesNotMatch(r, /data-nav-count/);
  assert.ok(rootTag(live).includes(`data-needs-count="0"`));
  assert.match(full, /<h1 class="sr-only">Home<\/h1>/);
});

test("health banner: shown when degraded or halted — the word, the first reason, the sentence, the first reason's fix", () => {
  assert.match(full, /<div class="health" data-verdict="degraded" role="status" aria-label="Harness status"><span class="health-icon" aria-hidden="true"><\/span><div class="health-main"><div class="health-title"><span class="health-word">Degraded<\/span> — The fleet is halted\.<\/div><div class="health-sub">Working, but a host is down\.<\/div>/);
  // ADR-0245 §3: the console credential may not resume — the fix is its CLI command.
  assert.match(full, /<div class="health-act"><span class="cli">Resume from the command line: <code>weave resume<\/code><\/span><\/div>/);
  assert.match(halted, /<div class="health" data-verdict="halted"[^>]*>.*<span class="health-word">Halted<\/span> — The fleet is halted by gateway/s);
  // Yolo-off, needs-you and nothing-queued are said elsewhere on the page (autonomy panel, KPI strip): not banner rows.
  assert.doesNotMatch(section(full), /class="health-reason" data-key="(yolo-off|needs-you)"/);
  assert.doesNotMatch(live, /class="health"/, "idle with only yolo-off and nothing-queued: no banner");
});

test("KPI strip: needs you (with its breakdown), running / slots, in progress, merged today, failed in 24 h", () => {
  assert.match(full, /<div class="kpis" aria-label="Summary">/);
  assert.match(full, /<a class="kpi" href="#needs-h" data-tone="needs"><span class="kpi-label">Needs you<\/span><span class="kpi-value num">7<\/span><span class="kpi-sub">2 grant · 1 factory · 1 fleet<\/span><\/a>/);
  assert.match(full, /<a class="kpi" href="\/work" data-tone=""><span class="kpi-label">Running<\/span><span class="kpi-value num">0 \/ 2<\/span><span class="kpi-sub">slots busy on 1 machine<\/span><\/a>/);
  assert.match(full, /<a class="kpi" href="\/work" data-tone="work"><span class="kpi-label">In progress<\/span><span class="kpi-value num">0<\/span><span class="kpi-sub">issues · nothing queued<\/span><\/a>/);
  assert.match(full, /<a class="kpi" href="\/work" data-tone="ok"><span class="kpi-label">Merged today<\/span><span class="kpi-value num">0<\/span><span class="kpi-sub">pull requests<\/span><\/a>/);
  assert.match(full, /<a class="kpi" href="\/audit\?since=24h" data-tone=""><span class="kpi-label">Failed 24h<\/span><span class="kpi-value num">0<\/span><span class="kpi-sub">of 3 tasks · 0%<\/span><\/a>/);
  assert.match(live, /<a class="kpi" href="#needs-h" data-tone="ok"><span class="kpi-label">Needs you<\/span><span class="kpi-value num">0<\/span><span class="kpi-sub">nothing waiting<\/span><\/a>/);
});

test("needs you: a panel with its count pill and filter chips (all, then each category present)", () => {
  assert.match(full, /<section class="panel needs" id="needs" aria-labelledby="needs-h" data-filter-scope="needs"><div class="panel-head"><h2 id="needs-h">Needs you<\/h2><span class="pill" data-tone="needs">7<\/span><div class="chips" role="group" aria-label="Filter Needs you"><button type="button" class="chip" data-filter="all" aria-pressed="true">All 8<\/button><button type="button" class="chip" data-filter="factory" aria-pressed="false">Factory 1<\/button><button type="button" class="chip" data-filter="fleet" aria-pressed="false">Fleet 1<\/button><button type="button" class="chip" data-filter="release" aria-pressed="false">Release 1<\/button><button type="button" class="chip" data-filter="grant" aria-pressed="false">Grant 2<\/button><button type="button" class="chip" data-filter="plan" aria-pressed="false">Plan 1<\/button><button type="button" class="chip" data-filter="other" aria-pressed="false">Other 2<\/button><\/div><\/div><div class="lrows">/);
  assert.match(live, /<h2 id="needs-h">Needs you<\/h2><span class="pill" data-tone="ok">0<\/span><\/div><p class="empty">Nothing needs you right now\.<\/p>/);
});

test("needs you: one dense row per item — tag, one-line title, one-line reason, age, inline actions", () => {
  assert.match(full, /<div class="lrow" data-key="grant:g-1" data-cat="grant" data-sev="needs-you"><span class="tag" data-tone="needs">Grant<\/span><div class="lrow-main"><div class="lrow-title" title="Fix the flaky test wants to run a command">Fix the flaky test wants to run a command<\/div><code class="lrow-code">\$ bun run test · in \/work\/repo<\/code><div class="lrow-why">denied by silence <time [^>]*data-fmt="until"/);
  assert.match(full, /hx-post="\/ui\/a\/grant" hx-swap="none"><input type="hidden" name="approve" value="g-1"><button class="btn primary" type="submit">Allow<\/button>/);
  assert.match(full, /<input type="hidden" name="deny" value="g-1"><button class="btn" type="submit">Deny<\/button>/);
  assert.ok(full.includes("wants to use hexa (build) — this spends Claude credits"));
  assert.match(full, /<span class="lrow-meta"><time [^>]*>[^<]*<\/time><\/span>/);
  assert.match(full, /<div class="lrow" data-key="attention:watch" data-cat="other" data-sev="watch"><span class="tag" data-tone="">Other<\/span>/);
});

test("needs you: a stage row starts or closes the issue", () => {
  assert.match(full, /<div class="lrow" data-key="stage:12" data-cat="factory" data-sev="needs-you"><span class="tag" data-tone="needs">Factory<\/span><div class="lrow-main"><div class="lrow-title" title="#12 Add a dark mode — ready for Build">#12 Add a dark mode — ready for Build<\/div><div class="lrow-why">Build will make the change\. Last stage: plan written, test committed<\/div>/);
  assert.match(full, /hx-post="\/ui\/a\/factoryAdvance" hx-swap="none"><input type="hidden" name="issue:num" value="12"><button class="btn primary" type="submit">Start Build<\/button>/);
  assert.match(full, /hx-post="\/ui\/a\/factoryClose"[^>]*data-confirm="Close #12\? Its open stages are cancelled, and an issue on the forge is closed there\."/);
  assert.match(full, /<a class="btn link" href="\/factory">Factory<\/a>/);
});

test("needs you: a plan is ticked — steps checked, roles not — and accepted or declined", () => {
  assert.match(full, /<div class="lrow" data-key="plan:p-1" data-cat="plan"[^>]*><span class="tag" data-tone="work">Plan<\/span>/);
  assert.ok(full.includes("The chief of staff proposes: Two steps and a new role"));
  assert.match(full, /For: <a href="\/task\?id=task-71de9ec3">Ship the release notes<\/a>/);
  assert.match(full, /<input type="hidden" name="accept" value="p-1">/);
  assert.match(full, /<input type="checkbox" name="steps:num\[\]" value="0" checked>/);
  assert.match(full, /<input type="checkbox" name="steps:num\[\]" value="1" checked>/);
  assert.match(full, /<input type="checkbox" name="roles:str\[\]" value="copywriter">/);
  assert.match(full, /about \$0\.42/);
  assert.match(full, />Start ticked<\/button>/);
  assert.match(full, /<input type="hidden" name="decline" value="p-1"><button class="btn" type="submit">Decline<\/button>/);
});

test("needs you: halt offers Resume (as its CLI command, ADR-0245 §3) and a new budget; attention rows keep who decides, actions and the fix", () => {
  assert.match(full, /<div class="lrow" data-key="halt" data-cat="fleet" data-sev="needs-you"><span class="tag" data-tone="bad">Fleet<\/span>/);
  assert.match(full, /<div class="lrow-acts"><span class="cli">Resume from the command line: <code>weave resume<\/code><\/span> <form class="act" hx-post="\/ui\/a\/budget"/);
  assert.match(full, /hx-post="\/ui\/a\/budget"[^>]*><input type="number" name="usd:num" min="0" step="5" placeholder="\$ per day" aria-label="New budget in dollars per day" required><button class="btn" type="submit">Raise budget<\/button>/);
  assert.match(full, /<span class="who" data-tone="auto">Yolo will decide this in 2h<\/span>/);
  assert.match(full, /<input type="hidden" name="approve:bool" value="true">/);
  assert.match(full, /<a class="btn" href="https:\/\/git.local\/gary\/weave\/pulls\/567" target="_blank" rel="noopener noreferrer">Open PR<\/a>/);
  assert.match(full, /<details class="lrow-more"><summary>Details<\/summary><pre>weave release merge 0\.2\.181<\/pre><\/details>/);
  assert.match(full, /<details class="lrow-more"><summary>How to fix<\/summary><pre>weave peers<\/pre><\/details>/);
  assert.doesNotMatch(full, /\/ui\/a\/fleet/);
});

test("side column: machines with CPU and memory bars, autonomy (yolo switch, chief of staff, spend), control plane", () => {
  assert.match(full, /<aside class="home-side">/);
  assert.match(full, /<h2 id="hosts-h">Machines<\/h2><a class="panel-link" href="\/machines">1 of 2 up →<\/a>/);
  assert.match(full, /<span class="host-name">local<\/span>/);
  assert.match(full, /<span class="hbar-label">CPU<\/span><meter class="bar" min="0" max="100" value="7" data-tone="ok" aria-label="local CPU load"><\/meter><span class="hbar-val num">7%<\/span>/);
  assert.match(full, /<span class="hbar-label">Mem<\/span><meter class="bar" min="0" max="100" value="43" data-tone="work" aria-label="local memory in use"><\/meter><span class="hbar-val num">43%<\/span>/);
  assert.match(full, /<span class="dot" data-tone="bad"><\/span><span class="host-name">max<\/span><span class="host-meta">not heard<\/span>/);
  assert.match(full, /<div class="switch-name">Yolo<\/div><div class="switch-sub">Ends <time [^>]*data-fmt="until"/);
  assert.match(full, /<span class="fleet-controls" data-on="true"><form class="act" hx-post="\/ui\/a\/yolo" hx-swap="none"><input type="hidden" name="off:bool" value="true"><button class="switch" type="submit">Turn yolo off<\/button><\/form><\/span>/);
  assert.match(live, /<span class="fleet-controls" data-on="false"><form class="act" hx-post="\/ui\/a\/yolo" hx-swap="none" data-confirm="Turn yolo on\? Until it ends[^"]*"><input type="hidden" name="on:bool" value="true"><select name="for" class="yolo-pick" aria-label="For how long">.*<option value="8h" selected>8 hours<\/option>.*<\/select><button class="btn primary" type="submit">Turn on<\/button><\/form><\/span>/s);
  assert.match(full, /<div class="switch-name">Chief of staff<\/div><div class="switch-sub">4 acts in the last hour<\/div><\/div><span class="dot" data-tone="ok" role="img" aria-label="on"><\/span>/);
  assert.match(full, /<div class="spend"><div class="spend-head"><span>Spend 24h<\/span><span class="num">\$23\.40 \/ \$25<\/span><\/div><meter class="bar" min="0" max="100" value="94" data-tone="needs" aria-label="Spend against the budget"><\/meter>/);
  assert.match(full, /<h2 id="cp-h">Control plane<\/h2><span class="pill" data-tone="needs">1 behind<\/span>/);
  assert.match(live, /<h2 id="cp-h">Control plane<\/h2><span class="pill" data-tone="ok">in sync 1\/1<\/span>/);
  for (const s of ["max-peer (budget)", "1 model setting differs: model.default", "1 breaker open", "Claude account at its usage limit", "failing over to openrouter", "Raft (shadow)", "2 drift findings · 1 fixed · 1 left", "27 open decisions", "autonomy full — 1 merge in 8h of cap 3"]) {
    assert.ok(full.includes(s), `control plane / autonomy fact: ${s}`);
  }
  assert.match(full, /<a href="\/factory">3 issues not started on the forge<\/a>/);
  assert.match(full, /<a class="panel-link" href="\/control">Review drift →<\/a>/);
});

test("lower row: working now (with Stop), done recently, decided for you, and Ask weave", () => {
  assert.match(full, /<div class="home-lower"><div class="home-col">/);
  assert.match(full, /<section class="panel" id="working" aria-labelledby="working-h"><div class="panel-head"><h2 id="working-h">Working now<\/h2>/);
  assert.match(full, /<a href="\/task\?id=task-aa">Fix the flaky test<\/a>/);
  assert.match(full, /hx-post="\/ui\/a\/cancel"[^>]*data-confirm="Stop &quot;Fix the flaky test&quot;\? The worker aborts; what it did so far is kept\."><input type="hidden" name="@" value="task-aa">/);
  assert.ok(full.includes("2 tasks waiting for a worker."));
  assert.match(live, /<p class="empty">Nothing is running\.<\/p>/);
  assert.match(full, /<h2 id="done-h">Done recently<\/h2><a class="panel-link" href="\/audit\?since=24h">All tasks<\/a>/);
  assert.match(full, /<span class="dot" data-tone="bad" role="img" aria-label="failed"><\/span>/);
  assert.ok(full.includes("Failed: exit 1"));
  assert.match(full, /<span class="dot" data-tone="" role="img" aria-label="cancelled"><\/span>/);
  assert.match(full, /<h2 id="decided-h">Decided for you<\/h2><span class="pill" data-tone="">2<\/span>/);
  assert.match(full, /<span class="tag" data-tone="auto">yolo<\/span>/);
  assert.match(full, /<a href="\/audit\?id=release-0\.2\.179">Audit<\/a>/);
  assert.match(live, /<p class="empty">Nothing was decided for you in the last 24 hours\.<\/p>/);
});

test("ask weave: turns, markdown answers, panels, files, progress; the composer and New conversation", () => {
  assert.match(full, /<aside class="chat panel" id="chat-panel" aria-label="Ask weave">/);
  assert.match(full, /<h4>Done<\/h4>/);
  assert.match(full, /<strong>one<\/strong>/);
  assert.match(full, /<a href="\/file\?path=%2Fwork%2Freports%2Fdash\.md&amp;task=chat-2" target="_blank" rel="noopener" title="\/work\/reports\/dash\.md">dash\.md<\/a>/);
  assert.match(full, /<div class="metrics">/);
  assert.match(full, /Working on it/);
  assert.match(full, /<li>reading the log<\/li>/);
  assert.match(full, /Waiting for a worker…/);
  assert.match(full, /That didn&#39;t work\./);
  assert.match(full, /<form class="composer" hx-post="\/ui\/a\/chat" hx-swap="none"><textarea name="text" [^>]*data-enter-submits[^>]*><\/textarea>/);
  assert.match(full, /hx-post="\/ui\/a\/chat"[^>]*data-confirm="Start a new conversation\? Weave stops carrying this one into its answers; it stays in the record\."><input type="hidden" name="reset:bool" value="true"><button class="btn link" type="submit">New conversation<\/button>/);
});

test("sidebar fragments, out of band: the network chip, each nav item's live value, and the sidebar foot", () => {
  const after = full.slice(section(full).length);
  assert.ok(after.startsWith('<div id="side-net" hx-swap-oob="innerHTML">'), `fragments follow the section: ${after.slice(0, 80)}`);
  assert.equal(oob(full, "side-net"), '<span class="dot" data-tone="bad"></span><span class="net-main"><span class="net-name">weave</span><span class="net-sub">0.2.180 · degraded</span></span>');
  assert.equal(oob(live, "side-net"), '<span class="dot" data-tone=""></span><span class="net-main"><span class="net-name">weave</span><span class="net-sub">0.2.180 · idle</span></span>');
  assert.equal(oob(full, "nav-meta-home"), '<span class="pill" data-tone="needs">7</span>');
  assert.equal(oob(live, "nav-meta-home"), "");
  assert.equal(oob(full, "nav-meta-work"), '<span class="count">0</span>');
  assert.equal(oob(full, "nav-meta-factory"), "");
  assert.equal(oob(full, "nav-meta-machines"), '<span class="count" data-tone="bad">1/2</span>');
  assert.equal(oob(live, "nav-meta-machines"), '<span class="count" data-tone="ok">1/1</span>');
  assert.equal(oob(full, "nav-meta-team"), '<span class="count">1</span>');
  assert.equal(oob(full, "nav-meta-control"), '<span class="dot" data-tone="needs" role="img" aria-label="1 setting differs · 1 peer behind"></span>');
  assert.equal(oob(live, "nav-meta-control"), "");
  const foot = oob(full, "side-foot");
  assert.match(foot, /^<div class="side-row"><span class="dot" data-tone="needs"><\/span><span class="side-yolo" data-on="true">Yolo on<\/span><span class="side-end"><time [^>]*data-fmt="until"[^>]*>[^<]*<\/time><\/span><\/div>/);
  assert.match(foot, /<div class="side-spend"><div class="side-row"><span>Spend 24h<\/span><span class="side-end num">\$23\.40 \/ \$25<\/span><\/div><meter class="bar" min="0" max="100" value="94" data-tone="needs" aria-label="Spend against the budget"><\/meter><\/div>/);
  // ADR-0245 §3: halt is the CLI command; a halted fleet says so without a second Resume command.
  assert.match(foot, /<div class="side-halt"><span class="cli">Halt from the command line: <code>weave halt<\/code><\/span><\/div>$/);
  assert.match(oob(live, "side-foot"), /<span class="dot"><\/span><span class="side-yolo" data-on="false">Yolo off<\/span>/);
  assert.match(oob(halted, "side-foot"), /<div class="side-halt"><span class="side-halted">■ Fleet halted<\/span><\/div>$/);
});

test("Machines fragments, out of band: per-host telemetry tiles (load, memory, slots) and the model-setting drift table", () => {
  assert.equal(
    oob(full, "host-telemetry"),
    '<div class="tele panel"><div class="tele-head"><span class="dot" data-tone="ok"></span><b>local</b><span class="tele-spec">32 cores · GPU</span></div><div class="tele-stats"><div class="stat"><div class="stat-label">Load</div><div class="stat-value num" data-tone="ok">2.09</div><div class="stat-sub">of 32 cores</div></div><div class="stat"><div class="stat-label">Memory</div><div class="stat-value num" data-tone="">43%</div><div class="stat-sub">in use</div></div><div class="stat"><div class="stat-label">Slots</div><div class="stat-value num" data-tone="">—</div><div class="stat-sub">busy</div></div></div></div>',
  );
  assert.match(oob(full, "model-drift"), /^<section class="panel"><div class="panel-head"><h2>Model settings that differ<\/h2><span class="pill" data-tone="needs">1 setting<\/span><\/div><div class="table-wrap"><table class="table"><thead><tr><th>Setting<\/th><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td class="mono">model\.default<\/td><td>opus <span class="muted">log<\/span><\/td><td>sonnet <span class="muted">env<\/span><\/td><\/tr><\/tbody><\/table><\/div><\/section>$/);
  assert.equal(oob(live, "model-drift"), "");
  const order = [...full.matchAll(/<[a-z]+ id="([a-z-]+)" hx-swap-oob="innerHTML">/g)].map((m) => m[1]);
  assert.deepEqual(order.slice(-3), ["side-foot", "host-telemetry", "model-drift"]);
});
