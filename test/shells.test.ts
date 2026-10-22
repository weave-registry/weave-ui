/**
 * The Phase 2 page shells (assets/pages/<page>.html): the layout weave's Phase 3 page routes will render, with the
 * page's views loaded by htmx. Same origin, no inline script or style, htmx configured by meta (ADR-0234 §4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOSTILE_PAYLOADS, htmlShape, sameShape } from "../vendor/weave/html-shape.js";
import { layout } from "../src/layout.js";
import { CTX, DIST } from "./helpers.js";

const VIEWS: Record<string, string[]> = {
  home: ["home"], work: ["work"], control: ["control"], factory: ["factory"], machines: ["fleet", "machines"],
  team: ["team"], task: ["task"], audit: ["audit"],
};
const shell = (p: string): string => readFileSync(join(DIST, "assets", "pages", `${p}.html`), "utf8");
const attr = (h: string, re: RegExp): string | undefined => re.exec(h)?.[1];

test("htmx is configured by <meta name=htmx-config>: no eval, no script tags, same-origin only, no inline styles, no history cache, refusals swapped", () => {
  for (const p of Object.keys(VIEWS)) {
    const raw = attr(shell(p), /<meta name="htmx-config" content='([^']*)'>/);
    assert.ok(raw, `${p}: no htmx-config meta`);
    const c = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, unknown>;
    assert.equal(c.allowEval, false);
    assert.equal(c.allowScriptTags, false);
    assert.equal(c.selfRequestsOnly, true);
    assert.equal(c.includeIndicatorStyles, false);
    assert.equal(c.historyCacheSize, 0);
    const rh = c.responseHandling as { code: string; swap: boolean; error?: boolean }[];
    assert.ok(Array.isArray(rh));
    assert.ok(rh.some((r) => r.code === "[45].." && r.swap === true), `${p}: 4xx/5xx refusals must swap so the error fragment shows`);
  }
});

test("each shell loads htmx then app.js (deferred, same origin), weave.css and the favicon — nothing else", () => {
  for (const p of Object.keys(VIEWS)) {
    const h = shell(p);
    const scripts = [...h.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map((m) => m[1]);
    assert.deepEqual(scripts, ["/ui/assets/htmx-2.0.11.min.js", "/ui/assets/app.js"], p);
    assert.match(h, /<link rel="stylesheet" href="\/ui\/assets\/weave.css">/);
    assert.match(h, /<link rel="icon" href="\/ui\/assets\/favicon.svg" type="image\/svg\+xml">/);
    assert.doesNotMatch(h, /https?:\/\//, `${p}: no off-origin URL`);
  }
});

// The redesign's sidebar (docs/plans/2026-10-23-redesign-spec.md, "The shell"): the nav in two groups.
const GROUPS: [string, string[]][] = [["Operate", ["home", "work", "factory", "audit"]], ["Fleet", ["machines", "team", "control"]]];
const TITLES: Record<string, string> = { home: "Home", work: "Work", control: "Control", factory: "Factory", machines: "Machines", team: "Team", task: "Task", audit: "Full record" };

test("each shell: the sidebar — mark, network chip, the nav in two groups (each core page once, its live slot, the current page marked), the sidebar foot", () => {
  for (const p of Object.keys(VIEWS)) {
    const h = shell(p);
    assert.match(h, /<div class="app"><aside class="side" aria-label="Sidebar"><a class="brand" href="\/"><span class="mark" aria-hidden="true"><\/span>weave<\/a><div class="net" id="side-net">/, `${p}: sidebar head`);
    const nav = /<nav id="nav" class="nav" aria-label="Console">([\s\S]*?)<\/nav>/.exec(h)?.[1];
    assert.ok(nav, `${p}: no nav`);
    const groups = nav.split(/<span class="nav-group">([^<]+)<\/span>/).slice(1);
    const seen: [string, string[]][] = [];
    for (let i = 0; i < groups.length; i += 2) {
      const links = [...groups[i + 1]!.matchAll(/<a href="([^"]+)" data-key="([^"]+)"( aria-current="page")?><span class="nav-label">([^<]+)<\/span><span class="nav-meta" id="nav-meta-([^"]+)"><\/span><\/a>/g)];
      for (const m of links) {
        const entry = CTX.nav.find((n) => n.key === m[2]);
        assert.ok(entry, `${p}: unknown nav key ${m[2]}`);
        assert.equal(m[1], entry.path, `${p}: ${m[2]} path`);
        assert.equal(m[4], entry.label, `${p}: ${m[2]} label`);
        assert.equal(m[5], m[2], `${p}: ${m[2]} live slot id`);
        assert.equal(Boolean(m[3]), m[2] === p, `${p}: aria-current on ${m[2]}`);
      }
      seen.push([groups[i]!, links.map((m) => m[2]!)]);
    }
    assert.deepEqual(seen, GROUPS, `${p}: nav groups`);
    assert.match(h, /<\/nav><div class="side-foot" id="side-foot"><\/div><\/aside>/, `${p}: sidebar foot`);
    assert.match(h, /<div id="weave-error"[^>]*role="alert"/, `${p}: error region`);
    assert.match(h, /<body[^>]* hx-ext="weave-json"/, `${p}: encoder`);
    assert.match(h, /<body[^>]* data-shell="[a-z]+"/, `${p}: data-shell`);
    assert.match(h, /<html lang="en">/);
    assert.match(h, /<title>[^<]+ · weave<\/title>/);
  }
});

test("each shell: the top bar — a breadcrumb naming the page, and a search box that searches the record (GET /audit?find=)", () => {
  for (const p of Object.keys(VIEWS)) {
    const h = shell(p);
    assert.match(h, new RegExp(`<div class="frame"><header class="topbar"><div class="crumb"><span>weave</span> <span class="sep">/</span> <b>${TITLES[p]}</b></div>`), `${p}: crumb`);
    assert.match(h, /<form class="search" action="\/audit" method="get" role="search"><input type="search" name="find" placeholder="[^"]+" aria-label="Search the record"><\/form><\/header>/, `${p}: search`);
  }
});

test("every shell but Home carries the hidden Home feed (#view-home loads /ui/f/home once, then polls itself); Home has its own", () => {
  for (const p of Object.keys(VIEWS)) {
    const h = shell(p);
    assert.equal((h.match(/id="view-home"/g) ?? []).length, 1, `${p}: one #view-home`);
    if (p === "home") assert.doesNotMatch(h, /id="view-home"[^>]* hidden/);
    else assert.match(h, /<div id="view-home" hx-get="\/ui\/f\/home" hx-trigger="load" hx-swap="none" hidden><\/div>/, `${p}: feed`);
  }
});

test("layout(): a hostile nav label, key or path keeps the shell's shape (escaped by the html tag)", () => {
  const base = { page: "work", title: "Work", views: [{ name: "work" }], htmxFile: "htmx-2.0.11.min.js" } as const;
  const ref = layout({ ...base, ctx: { api: "1.2", nav: CTX.nav.map((n) => ({ ...n })) } });
  for (const p of HOSTILE_PAYLOADS) {
    for (const field of ["label", "key", "path"] as const) {
      const nav = CTX.nav.map((n, i) => (i === 3 ? { ...n, [field]: field === "path" ? `/x${p}` : p } : { ...n }));
      const out = layout({ ...base, ctx: { api: "1.2", nav } });
      assert.ok(sameShape(ref, out), `${field} = ${JSON.stringify(p.slice(0, 30))}`);
    }
  }
});

test("each shell loads its views by htmx on load, swapping by id (out of band), and task/audit carry the page's query", () => {
  for (const [p, views] of Object.entries(VIEWS)) {
    const shape = htmlShape(shell(p));
    for (const v of views) {
      const re = new RegExp(`<[a-z]+ id="view-${v}"[^>]*>`);
      const tag = re.exec(shell(p))?.[0];
      assert.ok(tag, `${p}: no #view-${v}`);
      assert.match(tag, new RegExp(`hx-get="/ui/f/${v}"`));
      assert.match(tag, /hx-trigger="load"/);
      assert.match(tag, /hx-swap="none"/);
      if (p === "task" || p === "audit") assert.match(tag, /data-query-from-location/);
    }
    assert.ok(shape.length > 10);
  }
});

test("Home's out-of-band fragments always have a target: Machines shows #host-telemetry above its cards and #model-drift below them; every other page keeps both in a hidden sink", () => {
  for (const p of Object.keys(VIEWS)) {
    const h = shell(p);
    for (const id of ["host-telemetry", "model-drift"]) assert.equal((h.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `${p}: one #${id}`);
    if (p === "machines") {
      assert.match(h, /<main class="page[^"]*" id="main"><div id="host-telemetry" class="telemetry"><\/div><div id="view-machines"[^>]*>.*?<\/div><div id="model-drift"><\/div><div id="view-fleet"/s);
      assert.doesNotMatch(h, /class="sink"/);
    } else {
      assert.match(h, /<\/main><div class="sink" hidden><div id="host-telemetry"><\/div><div id="model-drift"><\/div><\/div>/, `${p}: sink`);
    }
  }
});
