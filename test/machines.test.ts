/** `machines` and `fleet` at parity with weave's Machines page (docs/parity/factory-machines-team.md, ## Machines). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { CTX, ROOT } from "./helpers.js";

const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));
const T = templates as Record<string, (v: unknown, c: unknown) => string>;
const m = T.machines!(fx("machines.full"), CTX);
const mlive = T.machines!(fx("machines.live"), CTX);
const f = T.fleet!(fx("fleet.full"), CTX);
const flive = T.fleet!(fx("fleet.live"), CTX);

test("machines root: #view-machines, polled, out of band; the head says connected, agents and versions", () => {
  const r = /^<section [^>]*>/.exec(m)?.[0] ?? "";
  for (const a of [`id="view-machines"`, `hx-get="/ui/f/machines"`, `hx-trigger="every 10s"`, `hx-swap="none"`, `hx-swap-oob="true"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.doesNotMatch(r, /data-nav-count/);
  assert.match(m, /<div class="page-head"><h1>Machines<\/h1><span class="sub"><b data-tone="bad">1 of 3<\/b> connected · 4 agents · on 0\.2\.180, 0\.2\.170<\/span><\/div>/);
  assert.match(mlive, /<b data-tone="ok">1 of 1<\/b> connected · 1 agent · all on 0\.2\.180/);
});

test("machine cards: one panel per host — dot, name, when heard, remedy; all departed folds to one line", () => {
  assert.match(m, /<div class="hosts" id="machines"><article class="panel host-card" data-quiet="false"><div class="panel-head"><span class="dot" data-tone="ok"><\/span><h2>This machine<\/h2><span class="host-heard">heard <time/);
  assert.match(m, /<article class="panel host-card" data-quiet="true"><div class="panel-head"><span class="dot" data-tone="needs"><\/span><h2>max<\/h2><span class="host-heard">not heard since <time/);
  assert.match(m, /<p class="host-remedy"><code>weave peers check max<\/code><\/p>/);
  assert.match(m, /<h2>gone<\/h2><span class="host-heard">not heard since <time[^>]*>[^<]*<\/time><\/span><\/div><p class="empty">1 departed agent<\/p><\/article>/);
});

test("agent rows: state dot, what it does, backend and version, outdated badge, Pause with confirm / Resume, departed folded", () => {
  assert.match(m, /<div class="lrow"><span class="dot" data-tone="work"><\/span><div class="lrow-main"><div class="lrow-title">dev<span class="muted"> · developer<\/span><\/div><div class="lrow-why">Working on <a href="\/task\?id=t-1">Dark mode<\/a><\/div><\/div><span class="lrow-meta">claude · weave 0\.2\.170<\/span><span class="badge" data-tone="needs">older than 0\.2\.180<\/span><div class="lrow-acts">/);
  assert.ok(m.includes("Paused by gary — maintenance"));
  assert.match(m, /hx-post="\/ui\/a\/agent" hx-swap="none"><input type="hidden" name="resume" value="max-p"><button[^>]*>Resume<\/button>/);
  assert.match(m, /data-confirm="Pause dev\? It finishes what it is doing now, then takes no new work until you resume it\."><input type="hidden" name="pause" value="max-dev"><input type="hidden" name="reason" value="paused from the console">/);
  assert.match(m, /<span class="dot" data-tone="bad"><\/span><div class="lrow-main"><div class="lrow-title">s<\/div><div class="lrow-why">Not heard from since <time/);
  assert.match(m, /<details class="lrow-more" data-keep="departed:max"><summary>\+1 departed<\/summary>/);
});

test("fleet root: #view-fleet, polled, out of band; scope cards with state badges", () => {
  const r = /^<section [^>]*>/.exec(f)?.[0] ?? "";
  for (const a of [`id="view-fleet"`, `hx-get="/ui/f/fleet"`, `hx-swap="none"`, `hx-swap-oob="true"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.ok(f.includes("Scopes on this machine"));
  assert.ok(f.includes("· 3 scopes · 2 live agents · 1 needing attention"));
  assert.match(f, /<span class="badge" data-tone="work">this daemon<\/span>/);
  assert.match(f, /<span class="badge" data-tone="bad">needs attention<\/span>/);
  assert.match(f, /data-state="attention"/);
});

test("fleet: a down link raises an alert; another scope reads as read-only detail", () => {
  assert.match(f, /<div class="card bad" role="alert">/);
  assert.ok(f.includes("max cannot reach mini.lan:8790"));
  assert.ok(f.includes("ECONNREFUSED · down 10m."));
  assert.match(f, /<details class="card scope-detail"[^>]*><summary>lab<\/summary>/);
  assert.ok(f.includes("Read-only — this console serves default."));
  assert.ok(f.includes("max.lan:8790 (stale address)"));
  assert.match(f, /<span class="badge" data-tone="bad"[^>]*>↓ max.lan:8790 · ECONNREFUSED<\/span>|<span class="badge" data-tone="bad"[^>]*>↓ mini.lan:8790 · ECONNREFUSED<\/span>/);
  assert.ok(f.includes("No agent has heartbeated from this node."));
  assert.ok(f.includes("Could not read this scope&#39;s log: cannot open"));
  assert.doesNotMatch(flive, /scope-detail/);
});
