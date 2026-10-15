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

test("machines root: #view-machines, polled, out of band, quiet count on the nav", () => {
  const r = /^<section [^>]*>/.exec(m)?.[0] ?? "";
  for (const a of [`id="view-machines"`, `hx-get="/ui/f/machines"`, `hx-trigger="every 10s"`, `hx-swap="none"`, `hx-swap-oob="true"`, `data-nav-count="machines:2"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.match(m, /<h1>Machines<\/h1>/);
  assert.ok(m.includes("3 machines, 2 not heard from."));
  assert.ok(mlive.includes("1 machine, all connected."));
});

test("machine cards: connected, quiet with remedy, all departed", () => {
  assert.match(m, /Connected · last heard <time/);
  assert.match(m, /class="card needs"/);
  assert.ok(m.includes("weave peers check max"));
  assert.match(m, /Not heard from since <time[^>]*>[^<]*<\/time> · 1 departed agent/);
});

test("agent rows: working on a task, paused with Resume, Pause with confirm, outdated badge, departed", () => {
  assert.match(m, /Working on <a href="\/task\?id=t-1">Dark mode<\/a>/);
  assert.ok(m.includes("Paused by gary — maintenance"));
  assert.match(m, /hx-post="\/ui\/a\/agent" hx-swap="none"><input type="hidden" name="resume" value="max-p"><button[^>]*>Resume<\/button>/);
  assert.match(m, /data-confirm="Pause dev\? It finishes what it is doing now, then takes no new work until you resume it\."><input type="hidden" name="pause" value="max-dev"><input type="hidden" name="reason" value="paused from the console">/);
  assert.match(m, /<span class="badge" data-tone="needs">older than 0\.2\.180<\/span>/);
  assert.match(m, /<summary>\+1 departed<\/summary>/);
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
