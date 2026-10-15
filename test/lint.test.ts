/** ADR-0234 §4: no hx-on*, no inline on* handler, no inline <script>/<style>, no style= — in any output. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintHtml } from "../scripts/lint.js";
import { templates } from "../src/templates/index.js";
import { CTX, DIST, fixtures, walk } from "./helpers.js";

test("lintHtml flags each refused construct", () => {
  const bad: [string, RegExp][] = [
    [`<a onclick="x()">x</a>`, /handler/i],
    [`<img src="/x.png" ONERROR="x()">`, /handler/i],
    [`<a hx-on:click="x()">x</a>`, /hx-on/i],
    [`<a hx-on-click="x()">x</a>`, /hx-on/i],
    [`<div hx-vars="a:1"></div>`, /hx-vars/i],
    [`<script>alert(1)</script>`, /inline script/i],
    [`<script src="/ui/assets/app.js">alert(1)</script>`, /inline script/i],
    [`<style>p{}</style>`, /style/i],
    [`<p style="color:red">x</p>`, /style/i],
    [`<a href="javascript:alert(1)">x</a>`, /javascript:/i],
    [`<a href=" JavaScript:alert(1)">x</a>`, /javascript:/i],
    [`<iframe src="/x"></iframe>`, /iframe/i],
    [`<base href="/">`, /base/i],
  ];
  for (const [h, re] of bad) {
    const problems = lintHtml(h);
    assert.ok(problems.length > 0, `not flagged: ${h}`);
    assert.ok(problems.some((p) => re.test(p)), `${h}: ${problems.join("; ")}`);
  }
});

test("lintHtml passes clean markup, including a script tag that only loads a file", () => {
  assert.deepEqual(lintHtml(`<script src="/ui/assets/htmx-2.0.11.min.js" defer></script><a href="/task?id=1" data-confirm="Stop?">x</a><div hx-get="/ui/f/home" hx-trigger="load" hx-swap="none"></div>`), []);
});

test("every template's output over every fixture is lint-clean", () => {
  const t = templates as Record<string, (vm: unknown, ctx: unknown) => string>;
  for (const f of fixtures()) {
    const fn = t[f.template];
    assert.ok(fn, `no template '${f.template}'`);
    assert.deepEqual(lintHtml(fn(f.vm, CTX)), [], `${f.template}.${f.name}`);
  }
});

test("every built HTML asset (the page shells) is lint-clean", () => {
  const pages = walk(join(DIST, "assets")).filter((p) => p.endsWith(".html"));
  assert.ok(pages.length > 0);
  for (const p of pages) assert.deepEqual(lintHtml(readFileSync(join(DIST, "assets", p), "utf8")), [], p);
});
