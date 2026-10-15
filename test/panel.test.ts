/** src/ui/panel.ts — the answer panels an agent put on the board (dom-js.ts weave.panel), from text only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel } from "../src/ui/panel.js";
import { toHtml } from "../src/html.js";

const p = (x: unknown): string => toHtml(panel(x));

test("show_metrics, show_table, show_answer", () => {
  assert.match(p({ type: "show_metrics", title: "Fleet", items: [{ label: "Agents", value: 3, status: "ok" }] }), /<div class="card panel"><div class="card-title">Fleet<\/div><div class="metrics"><div class="metric" data-tone="ok"><div class="metric-value num">3<\/div><div class="metric-label">Agents<\/div>/);
  assert.match(p({ type: "show_table", columns: ["a"], rows: [["<b>"]] }), /<table><thead><tr><th>a<\/th><\/tr><\/thead><tbody><tr><td>&lt;b&gt;<\/td><\/tr><\/tbody><\/table>/);
  assert.match(p({ type: "show_answer", text: "plain" }), /<p class="panel-text">plain<\/p>/);
});

test("show_chart draws bars as <meter>, never an inline style (CSP style-src 'self')", () => {
  const h = p({ type: "show_chart", series: [{ label: "mon", value: 2 }, { label: "tue", value: 4 }] });
  assert.match(h, /<meter min="0" max="100" value="50">/);
  assert.match(h, /<meter min="0" max="100" value="100">/);
  assert.doesNotMatch(h, /style=/);
});

test("show_ui component trees, bounded in depth", () => {
  assert.match(p({ type: "show_ui", ui: { component: "Card", props: { title: "T" }, children: [{ component: "Text", props: { text: "hi" } }] } }), /<div class="card"><div class="card-title">T<\/div><p>hi<\/p><\/div>/);
  let deep: unknown = { component: "Text", props: { text: "bottom" } };
  for (let i = 0; i < 50; i++) deep = { component: "Stack", children: [deep] };
  assert.doesNotMatch(p({ type: "show_ui", ui: deep }), /bottom/);
});

test("anything malformed renders an empty card, never throws", () => {
  for (const x of [null, 1, "s", { type: "show_table", rows: "x" }, { type: "show_ui", ui: { component: "Button", props: { label: { a: 1 } } } }]) {
    assert.match(p(x), /^<div class="card panel">/);
  }
});
