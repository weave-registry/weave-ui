/** ADR-0234 §4: one `html` tag, escaping by context, refused sites, no escape hatch. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mod from "../src/html.js";
import { html, toHtml, safeUrl, isSafeHtml } from "../src/html.js";

const s = (h: unknown): string => toHtml(h as never);

test("the module has no raw-HTML escape hatch", () => {
  for (const k of Object.keys(mod)) assert.doesNotMatch(k, /raw|unsafe|trust|dangerous|unescaped/i, `export ${k}`);
});

test("text is escaped: & < > \" '", () => {
  assert.equal(s(html`<p>${`<b>&"'`}</p>`), "<p>&lt;b&gt;&amp;&quot;&#39;</p>");
  assert.equal(s(html`<textarea>${"</textarea><script>x</script>"}</textarea>`), "<textarea>&lt;/textarea&gt;&lt;script&gt;x&lt;/script&gt;</textarea>");
});

test("a quoted attribute value is escaped", () => {
  assert.equal(s(html`<a title="${`"><img src=x onerror=alert(1)>`}">x</a>`), `<a title="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;">x</a>`);
  assert.equal(s(html`<a title='${`'><b>`}'>x</a>`), `<a title='&#39;&gt;&lt;b&gt;'>x</a>`);
  assert.equal(s(html`<input name="n" value="${"a&b"}">`), `<input name="n" value="a&amp;b">`);
});

test("values: SafeHtml nests, arrays join, nullish and false render nothing, numbers print", () => {
  const items = ["<a>", "b"].map((x) => html`<li>${x}</li>`);
  assert.equal(s(html`<ul>${items}</ul>`), "<ul><li>&lt;a&gt;</li><li>b</li></ul>");
  assert.equal(s(html`<ul>${["<x>", html`<li>y</li>`]}</ul>`), "<ul>&lt;x&gt;<li>y</li></ul>");
  assert.equal(s(html`<p>${null}${undefined}${false}${0}${1.5}</p>`), "<p>01.5</p>");
  assert.ok(isSafeHtml(html`<p></p>`));
  assert.equal(isSafeHtml("<p></p>"), false);
  assert.equal(isSafeHtml({ html: "<p></p>" }), false);
});

test("a value that is neither text, a number, SafeHtml nor a list of them is refused", () => {
  assert.throws(() => html`<p>${{ toString: () => "<b>" }}</p>`);
  assert.throws(() => html`<p>${true}</p>`);
  assert.throws(() => html`<p>${() => "x"}</p>`);
});

test("SafeHtml cannot be interpolated into an attribute", () => {
  assert.throws(() => html`<a title="${html`<b>x</b>`}">x</a>`);
});

test("safeUrl allows same-origin paths and http(s) only, percent-encoded", () => {
  assert.equal(safeUrl("/task?id=a b"), "/task?id=a%20b");
  assert.equal(safeUrl("/audit?thread=factory:12"), "/audit?thread=factory:12");
  assert.equal(safeUrl("https://git.local/gary/weave/issues/3"), "https://git.local/gary/weave/issues/3");
  assert.equal(safeUrl("HTTP://example.com/a\"b"), "HTTP://example.com/a%22b");
  assert.equal(safeUrl("/a<b>"), "/a%3Cb%3E");
  assert.equal(safeUrl("/50%25"), "/50%25");
  assert.equal(safeUrl("?id=1"), "?id=1");
  assert.equal(safeUrl("#needs-h"), "#needs-h");
  for (const bad of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:x", "data:text/html,<b>", "vbscript:x", "//evil.example/x", "/\\evil.example", "\\\\evil", "file:///etc/passwd", "relative/path", "", "mailto:a@b"]) {
    assert.equal(safeUrl(bad), "#", JSON.stringify(bad));
  }
});

test("href, src, action, formaction: a whole-value interpolation goes through safeUrl", () => {
  assert.equal(s(html`<a href="${"javascript:alert(1)"}">x</a>`), `<a href="#">x</a>`);
  assert.equal(s(html`<a href="${"/task?id=1&x=2"}">x</a>`), `<a href="/task?id=1&amp;x=2">x</a>`);
  assert.equal(s(html`<img src="${"data:image/svg+xml,<svg onload=alert(1)>"}" alt="">`), `<img src="#" alt="">`);
  assert.equal(s(html`<form action="${"//evil/x"}"></form>`), `<form action="#"></form>`);
  assert.equal(s(html`<button formaction="${"javascript:x"}"></button>`), `<button formaction="#"></button>`);
});

test("a URL attribute's interpolation after a static prefix is percent-encoded as one component", () => {
  assert.equal(s(html`<a href="/task?id=${`a&b c/"<`}">x</a>`), `<a href="/task?id=a%26b%20c%2F%22%3C">x</a>`);
  assert.equal(s(html`<a href="/audit?thread=factory:${"12#x"}">x</a>`), `<a href="/audit?thread=factory:12%23x">x</a>`);
});

test("hx-get/hx-post/hx-put/hx-patch/hx-delete: same-origin paths only", () => {
  assert.equal(s(html`<div hx-get="${"/ui/f/home"}"></div>`), `<div hx-get="/ui/f/home"></div>`);
  assert.equal(s(html`<div hx-get="${"https://evil.example/x"}"></div>`), `<div hx-get="#"></div>`);
  assert.equal(s(html`<div hx-post="${"javascript:x"}"></div>`), `<div hx-post="#"></div>`);
  assert.equal(s(html`<div hx-get="/ui/f/task?id=${`x"y&z`}"></div>`), `<div hx-get="/ui/f/task?id=x%22y%26z"></div>`);
});

test("refused sites: unquoted attribute, attribute name, tag name, script, style, comment", () => {
  const x = "v";
  assert.throws(() => html`<a title=${x}>x</a>`, /unquoted/i);
  assert.throws(() => html`<a ${x}="1">x</a>`, /attribute name/i);
  assert.throws(() => html`<${x}>x</a>`, /tag/i);
  assert.throws(() => html`<script>${x}</script>`, /script/i);
  assert.throws(() => html`<style>${x}</style>`, /style/i);
  assert.throws(() => html`<!-- ${x} -->`, /comment/i);
});

test("refused sites: on* and hx-on* handlers, style and srcdoc attributes, non-URL hx-* values", () => {
  const x = "v";
  assert.throws(() => html`<a onclick="${x}">x</a>`, /handler|on\*/i);
  assert.throws(() => html`<a hx-on:click="${x}">x</a>`, /handler|on\*/i);
  assert.throws(() => html`<a hx-on-click="${x}">x</a>`, /handler|on\*/i);
  assert.throws(() => html`<a style="${x}">x</a>`, /style/i);
  assert.throws(() => html`<iframe srcdoc="${x}"></iframe>`, /srcdoc/i);
  for (const attr of ["hx-vals", "hx-target", "hx-trigger", "hx-swap", "hx-confirm", "hx-headers", "hx-select", "hx-include", "hx-swap-oob"]) {
    assert.throws(() => html([`<a ${attr}="`, `">x</a>`] as unknown as TemplateStringsArray, x), new RegExp(attr), attr);
  }
});

test("static inline handlers and style attributes are refused even with nothing interpolated", () => {
  assert.throws(() => html`<a onclick="go()">x</a>`, /handler|on\*/i);
  assert.throws(() => html`<a hx-on:click="go()">x</a>`, /handler|on\*/i);
  assert.throws(() => html`<a style="color:red">x</a>`, /style/i);
});

test("data-* and other quoted attributes take escaped values", () => {
  assert.equal(s(html`<button data-confirm="${`Stop "x"?`}">Stop</button>`), `<button data-confirm="Stop &quot;x&quot;?">Stop</button>`);
  assert.equal(s(html`<time datetime="${"2026-10-15T00:00:00.000Z"}" data-ts="${123}">x</time>`), `<time datetime="2026-10-15T00:00:00.000Z" data-ts="123">x</time>`);
});

test("a large list renders well inside weave's 50 ms render cap", () => {
  const rows = Array.from({ length: 2000 }, (_, i) => `row ${i} <x>`);
  const t0 = performance.now();
  const out = s(html`<ul>${rows.map((r) => html`<li class="row" title="${r}"><a href="/task?id=${r}">${r}</a></li>`)}</ul>`);
  const took = performance.now() - t0;
  assert.ok(out.length > 2000 * 40);
  assert.ok(took < 50, `took ${took.toFixed(1)} ms`);
});
