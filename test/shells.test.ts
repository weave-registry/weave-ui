/**
 * The Phase 2 page shells (assets/pages/<page>.html): the layout weave's Phase 3 page routes will render, with the
 * page's views loaded by htmx. Same origin, no inline script or style, htmx configured by meta (ADR-0234 §4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { htmlShape } from "../vendor/weave/html-shape.js";
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

test("each shell: the core nav in weave's order, the current page marked, the error region, the JSON encoder on body", () => {
  for (const p of Object.keys(VIEWS)) {
    const h = shell(p);
    const links = [...h.matchAll(/<a href="([^"]+)" data-key="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)];
    assert.deepEqual(links.map((m) => m[2]), CTX.nav.map((n) => n.key), `${p}: nav order`);
    assert.deepEqual(links.map((m) => m[1]), CTX.nav.map((n) => n.path), `${p}: nav paths`);
    assert.deepEqual(links.filter((m) => m[3]).map((m) => m[2]), p === "task" ? [] : [p], `${p}: aria-current`);
    assert.match(h, /<div id="weave-error"[^>]*role="alert"/, `${p}: error region`);
    assert.match(h, /<body[^>]* hx-ext="weave-json"/, `${p}: encoder`);
    assert.match(h, /<body[^>]* data-shell="[a-z]+"/, `${p}: data-shell`);
    assert.match(h, /<html lang="en">/);
    assert.match(h, /<title>[^<]+ · weave<\/title>/);
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
