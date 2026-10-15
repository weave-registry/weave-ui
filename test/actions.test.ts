/**
 * src/ui/actions.ts — a gateway body as an htmx form posting to /ui/a/<verb>. Data travels in hidden inputs whose
 * names carry the JSON type for app.js's weave-json encoder (test/app.test.ts); no hx-* attribute carries data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_VERBS, actionForm, actionLink, attentionActions } from "../src/ui/actions.js";
import { toHtml } from "../src/html.js";

test("the verbs are weave's eighteen action routes (console-api.ts CONSOLE_ACTIONS)", () => {
  assert.deepEqual([...KNOWN_VERBS].sort(), ["agent", "budget", "cancel", "chat", "factory", "factoryAdvance", "factoryClose", "factoryDecide", "factoryNew", "fleet", "fleetDecide", "grant", "plan", "releaseMergeDecide", "role", "rolloutAbort", "rolloutDecide", "yolo"].sort());
});

test("an object body: one hidden input per field, typed by name", () => {
  const h = toHtml(actionForm({ fleetDecide: { id: "r-1", approve: true, n: 2, tags: ["a", "b"], nested: { k: "v" }, skip: null } }, { label: "Approve" }));
  assert.match(h, /^<form class="act" hx-post="\/ui\/a\/fleetDecide" hx-swap="none">/);
  assert.match(h, /<input type="hidden" name="id" value="r-1">/);
  assert.match(h, /<input type="hidden" name="approve:bool" value="true">/);
  assert.match(h, /<input type="hidden" name="n:num" value="2">/);
  assert.match(h, /<input type="hidden" name="tags:str\[\]" value="a"><input type="hidden" name="tags:str\[\]" value="b">/);
  assert.match(h, /<input type="hidden" name="nested\[k\]" value="v">/);
  assert.doesNotMatch(h, /skip/);
  assert.match(h, /<button class="btn primary" type="submit">Approve<\/button><\/form>$/);
});

test("a scalar body posts as @", () => {
  assert.match(toHtml(actionForm({ cancel: "task-1" }, { label: "Stop", tone: "danger", confirm: "Stop it?" })), /^<form class="act" hx-post="\/ui\/a\/cancel" hx-swap="none" data-confirm="Stop it\?"><input type="hidden" name="@" value="task-1"><button class="btn danger" type="submit">Stop<\/button>/);
  assert.match(toHtml(actionForm({ fleet: "halt" }, { label: "Halt", tone: "quiet" })), /name="@" value="halt".*<button class="btn" type="submit">Halt/);
});

test("an unknown verb, or a body with other than one key, is shown, not posted", () => {
  for (const body of [{ notAVerb: {} }, { grant: {}, cancel: "x" }, {}]) {
    const h = toHtml(actionForm(body as Record<string, unknown>, { label: "Odd" }));
    assert.doesNotMatch(h, /<form|hx-post/);
    assert.match(h, /aria-disabled="true"/);
  }
});

test("extra fields go inside the form, before the button", () => {
  const h = toHtml(actionForm({ budget: {} }, { label: "Raise budget", extra: [] }));
  assert.match(h, /hx-post="\/ui\/a\/budget"/);
});

test("links: internal stay in the tab, external open a new one, unsafe become #", () => {
  assert.equal(toHtml(actionLink("/factory", "Open Factory")), `<a class="btn" href="/factory">Open Factory</a>`);
  assert.equal(toHtml(actionLink("https://git.local/x", "PR")), `<a class="btn" href="https://git.local/x" target="_blank" rel="noopener noreferrer">PR</a>`);
  assert.equal(toHtml(actionLink("javascript:alert(1)", "x")), `<a class="btn" href="#">x</a>`);
});

test("attention actions: tone, confirm, and closing an issue always asks first", () => {
  const h = toHtml(attentionActions([
    { label: "Approve", body: { rolloutDecide: { id: "r", approve: true } } },
    { label: "Close", body: { factoryClose: { issue: 9 } }, tone: "quiet" },
    { label: "Deny", body: { grant: { deny: "g" } }, tone: "danger", confirm: "Sure?" },
    { label: "Read", href: "/audit?id=x" },
    "junk",
  ]));
  assert.match(h, /<button class="btn primary" type="submit">Approve/);
  assert.match(h, /data-confirm="Close #9\? Its open stages are cancelled, and an issue on the forge is closed there\."/);
  assert.match(h, /data-confirm="Sure\?".*<button class="btn danger" type="submit">Deny/);
  assert.match(h, /<a class="btn" href="\/audit\?id=x">Read<\/a>/);
});

test("a deeply nested body renders its shallow fields and skips the rest, never overflowing the stack", () => {
  let deep: Record<string, unknown> = { k: "bottom" };
  for (let i = 0; i < 20_000; i++) deep = { a: deep };
  const h = toHtml(actionForm({ fleet: { id: "f-1", deep } }, { label: "Go" }));
  assert.match(h, /<input type="hidden" name="id" value="f-1">/);
  assert.doesNotMatch(h, /bottom/);
  assert.match(toHtml(attentionActions([{ label: "Go", body: { fleet: deep } }])), /<form class="act" hx-post="\/ui\/a\/fleet"/);
  assert.match(toHtml(actionForm({ fleet: { a: { b: { c: "kept" } } } }, { label: "Go" })), /name="a\[b\]\[c\]" value="kept"/);
});

test("a body whose keys app.js would re-type or re-nest is shown, never posted", () => {
  const disabled = /<span class="btn" aria-disabled="true"[^>]*>Go<\/span>/;
  for (const inner of [
    { "x:num": "12" },
    { "x:bool": "yes" },
    { "a[b]": "v" },
    { "a]": "v" },
    { "@": "v" },
    { "": "v" },
    { opts: { "k[0]": "v" } },
    { opts: { "": "v" } },
  ]) {
    const h = toHtml(actionForm({ agent: inner }, { label: "Go" }));
    assert.match(h, disabled, JSON.stringify(inner));
    assert.doesNotMatch(h, /<form/, JSON.stringify(inner));
  }
  assert.match(toHtml(attentionActions([{ label: "Go", body: { agent: { "x:num": "12" } } }])), disabled);
  const ok = toHtml(actionForm({ agent: { "ns:id": "a", opts: { "x:num": "12" } } }, { label: "Go" }));
  assert.match(ok, /name="ns:id" value="a"/);
  assert.match(ok, /name="opts\[x:num\]" value="12"/);
});
