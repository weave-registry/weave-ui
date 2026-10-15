/** src/markdown.ts — weave's md subset (dom-js.ts weave.md), built with the html tag: never a string passed through. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { markdown } from "../src/markdown.js";
import { toHtml } from "../src/html.js";

const md = (s: string): string => toHtml(markdown(s));

test("blocks: headings shift down, paragraphs keep line breaks, rules, fenced code", () => {
  assert.equal(md("# A\n## B\n### C"), "<h3>A</h3><h4>B</h4><h5>C</h5>");
  assert.equal(md("one\ntwo\n\nthree"), "<p>one<br>two</p><p>three</p>");
  assert.equal(md("---"), "<hr>");
  assert.equal(md("```js\nx < 1\n```"), "<pre><code>x &lt; 1</code></pre>");
});

test("lists, quotes and tables", () => {
  assert.equal(md("- a\n- b\n  more"), "<ul><li>a</li><li>b more</li></ul>");
  assert.equal(md("1. a\n2) b"), "<ol><li>a</li><li>b</li></ol>");
  assert.equal(md("> quoted\n> **b**"), "<blockquote><p>quoted<br><strong>b</strong></p></blockquote>");
  assert.equal(md("| a | b |\n|---|:-:|\n| 1 | `2` |"), `<div class="table-wrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><code>2</code></td></tr></tbody></table></div>`);
});

test("inline: code, bold, links, emphasis, bare URLs (trailing punctuation outside)", () => {
  assert.equal(md("`a<b` **c** *d* _e_"), "<p><code>a&lt;b</code> <strong>c</strong> <em>d</em> <em>e</em></p>");
  assert.equal(md("[x](https://e.com/a)"), `<p><a href="https://e.com/a" target="_blank" rel="noopener noreferrer">x</a></p>`);
  assert.equal(md("see https://e.com/a."), `<p>see <a href="https://e.com/a" target="_blank" rel="noopener noreferrer">https://e.com/a</a>.</p>`);
});

test("hostile input stays text: tags, javascript: links, attribute breakouts", () => {
  assert.equal(md("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  assert.doesNotMatch(md("[x](javascript:alert(1))"), /javascript:/);
  assert.doesNotMatch(md(`[x]("onmouseover="alert(1))`), /onmouseover="/);
});

test("caps: 20 000 characters and 400 blocks", () => {
  const out = md("p\n\n".repeat(1000));
  assert.ok((out.match(/<p>/g) ?? []).length <= 400);
  assert.ok(md("a".repeat(50_000)).length < 21_000);
});

test("nothing, or not a string, is nothing", () => {
  assert.equal(md(""), "");
  assert.equal(toHtml(markdown(undefined as unknown as string)), "");
});
