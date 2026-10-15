/**
 * assets-src/app.js — the console's one script (ADR-0234 §4). Here: its htmx extension `weave-json`, which sends
 * every /ui action as the typed JSON body weave's action handlers expect (POST /ui/a/<verb> accepts
 * application/json). Field names carry the type: `k` string, `k:bool`, `k:num` (empty → omitted), `k:str[]`,
 * `k:num[]` (repeated fields), `a[b][c]` nesting, and `@` for a scalar body (cancel, fleet).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ROOT } from "./helpers.js";

interface Ext {
  onEvent?: (name: string, evt: unknown) => unknown;
  encodeParameters?: (xhr: unknown, params: FormData, elt: unknown) => unknown;
}

type Handler = (evt: unknown) => void;

function loadApp(dom: Record<string, unknown> = {}, on: Record<string, Handler[]> = {}): Record<string, Ext> {
  const exts: Record<string, Ext> = {};
  const noop = (): void => {};
  const el = { getAttribute: () => null, setAttribute: noop, dataset: {}, querySelectorAll: () => [], addEventListener: noop, closest: () => null };
  const sandbox = {
    htmx: { defineExtension: (n: string, e: Ext) => void (exts[n] = e), on: (n: string, h: Handler) => void (on[n] ??= []).push(h), process: noop, config: {} },
    document: { addEventListener: noop, querySelectorAll: () => [], querySelector: () => null, body: el, documentElement: el, activeElement: null, readyState: "loading", ...dom },
    window: { addEventListener: noop, location: { search: "", pathname: "/ui/assets/pages/home.html", hash: "" }, confirm: () => true },
    location: { search: "", pathname: "/ui/assets/pages/home.html", hash: "" },
    setInterval: noop, clearInterval: noop, setTimeout: noop, Intl, Date,
  };
  (sandbox.window as Record<string, unknown>).document = sandbox.document;
  (sandbox.window as Record<string, unknown>).htmx = sandbox.htmx;
  vm.runInNewContext(readFileSync(join(ROOT, "assets-src", "app.js"), "utf8"), sandbox, { filename: "app.js" });
  return exts;
}

function encode(entries: [string, string][]): unknown {
  const ext = loadApp()["weave-json"];
  assert.ok(ext?.encodeParameters, "app.js defines the htmx extension weave-json with encodeParameters");
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  const out = ext.encodeParameters({ overrideMimeType: () => {} }, fd, {});
  assert.equal(typeof out, "string");
  return JSON.parse(out as string);
}

test("weave-json marks the request as JSON", () => {
  const ext = loadApp()["weave-json"];
  assert.ok(ext?.onEvent);
  const detail = { headers: {} as Record<string, string>, verb: "post", path: "/ui/a/grant" };
  ext.onEvent("htmx:configRequest", { detail });
  assert.equal(detail.headers["Content-Type"], "application/json");
});

test("strings stay strings", () => {
  assert.deepEqual(encode([["approve", "g-1"]]), { approve: "g-1" });
  assert.deepEqual(encode([["title", "true"], ["text", "12"]]), { title: "true", text: "12" });
});

test(":bool is a boolean — and 'false' is false, never a truthy string", () => {
  assert.deepEqual(encode([["id", "r1"], ["approve:bool", "true"]]), { id: "r1", approve: true });
  assert.deepEqual(encode([["id", "r1"], ["approve:bool", "false"]]), { id: "r1", approve: false });
  assert.deepEqual(encode([["on:bool", "false"], ["on:bool", "true"]]), { on: true }, "last value wins (hidden false, then a ticked box)");
});

test(":num is a number; an empty or non-numeric field is omitted, never 0", () => {
  assert.deepEqual(encode([["issue:num", "12"]]), { issue: 12 });
  assert.deepEqual(encode([["usd:num", "7.5"]]), { usd: 7.5 });
  assert.deepEqual(encode([["usd:num", ""]]), {});
  assert.deepEqual(encode([["usd:num", "abc"]]), {});
});

test(":str[] and :num[] collect repeated fields into arrays", () => {
  assert.deepEqual(encode([["accept", "p1"], ["steps:num[]", "0"], ["steps:num[]", "2"], ["roles:str[]", "copywriter"]]), { accept: "p1", steps: [0, 2], roles: ["copywriter"] });
});

test("a[b][c] nests, keys may hold dots and slashes", () => {
  assert.deepEqual(
    encode([["define[name]", "copy"], ["define[files][persona.md]", "# hi"], ["define[files][skills/x/SKILL.md]", "s"], ["define[tools]:str[]", "bash"], ["define[tools]:str[]", "git"], ["define[budgetUsd]:num", "2"], ["define[overrides]:bool", "true"]]),
    { define: { name: "copy", files: { "persona.md": "# hi", "skills/x/SKILL.md": "s" }, tools: ["bash", "git"], budgetUsd: 2, overrides: true } },
  );
});

test("@ is the whole body: a scalar for cancel and fleet", () => {
  assert.equal(encode([["@", "task-9"]]), "task-9");
  assert.equal(encode([["@", "halt"]]), "halt");
});

test("no prototype pollution through field names", () => {
  encode([["__proto__[polluted]", "yes"], ["constructor[prototype][polluted]", "yes"]]);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

// A details[data-keep] / [data-keep-scroll] view, as a fake element: enough DOM for remember/restore.
function fakeView(id: string, open: boolean, scrollTop: number) {
  const details = { open, getAttribute: (a: string) => (a === "data-keep" ? "more" : null), hasAttribute: () => false, setAttribute: noopFn };
  const log = { id: `${id}-log`, scrollTop, scrollHeight: 1000, clientHeight: 100 };
  const view = {
    id, details, log,
    querySelectorAll: (sel: string) => (sel.startsWith("details") ? (sel.includes("[open]") ? (details.open ? [details] : []) : [details]) : sel.startsWith("[data-keep-scroll]") ? [log] : []),
  };
  return view;
}
function noopFn(): void {}

test("kept <details>/scroll state of the main target survives an OOB swap that runs before the main swap", () => {
  const els: Record<string, unknown> = {};
  const on: Record<string, Handler[]> = {};
  const dom = {
    getElementById: (id: string) => els[id] ?? null,
    querySelector: () => null,
    title: "weave",
  };
  loadApp(dom, on);
  const fire = (name: string, detail: unknown): void => (on[name] ?? []).forEach((h) => h({ detail }));

  // Old main view: the operator opened the details and scrolled the log up from the bottom.
  const oldMain = fakeView("view-runs", true, 300);
  els["view-runs"] = oldMain;
  els["view-runs-log"] = oldMain.log;
  const oobTarget = { id: "weave-error", querySelectorAll: () => [] };
  els["weave-error"] = oobTarget;

  // htmx 2.0.11 order: beforeSwap (main) → OOB swaps → main swap → afterSettle.
  fire("htmx:beforeSwap", { target: oldMain });
  fire("htmx:oobBeforeSwap", { target: oobTarget });
  fire("htmx:oobAfterSwap", { target: oobTarget });
  const newMain = fakeView("view-runs", false, 0);
  els["view-runs"] = newMain;
  els["view-runs-log"] = newMain.log;
  fire("htmx:afterSettle", {});

  assert.equal(newMain.details.open, true, "the fresh <details data-keep> keeps the operator's open state");
  assert.equal(newMain.log.scrollTop, 300, "the fresh [data-keep-scroll] keeps its scroll position");
});

test("an OOB #weave-error from a 2xx response stays shown; the next successful request clears it", () => {
  const on: Record<string, Handler[]> = {};
  const err = { id: "weave-error", hidden: false, cleared: 0, replaceChildren() { this.cleared++; } };
  loadApp({ getElementById: (id: string) => (id === "weave-error" ? err : null), title: "weave" }, on);
  const fire = (name: string, detail: unknown): void => (on[name] ?? []).forEach((h) => h({ detail }));

  // htmx 2.0.11: htmx:oobAfterSwap's detail is {shouldSwap, target, fragment} — no xhr.
  const xhr1 = {};
  fire("htmx:beforeSwap", { xhr: xhr1, target: {} });
  fire("htmx:oobAfterSwap", { shouldSwap: true, target: err, fragment: {} });
  fire("htmx:afterRequest", { xhr: xhr1, successful: true, elt: null });
  assert.equal(err.hidden, false, "the error this response just swapped in is kept");
  assert.equal(err.cleared, 0);

  fire("htmx:afterRequest", { xhr: {}, successful: true, elt: null });
  assert.equal(err.hidden, true, "a later successful request clears the stale error");
  assert.equal(err.cleared, 1);
});

test("the audit check is finished by the audit request's own settle, not by an unrelated swap that settles first", () => {
  const on: Record<string, Handler[]> = {};
  let sha = "aaa";
  const out = { textContent: "", tone: "", setAttribute(a: string, v: string) { if (a === "data-tone") this.tone = v; } };
  const shaEl = { getAttribute: (a: string) => (a === "data-audit-sha" ? sha : null) };
  loadApp({
    getElementById: () => null,
    title: "weave",
    querySelector: (sel: string) => (sel === "#view-audit [data-audit-sha]" ? shaEl : sel === "#view-audit [data-audit-result]" ? out : null),
  }, on);
  const fire = (name: string, detail: unknown): void => (on[name] ?? []).forEach((h) => h({ detail }));
  const button = { hasAttribute: (a: string) => a === "data-audit-check", getAttribute: () => null };

  const auditXhr = { status: 200 };
  fire("htmx:beforeRequest", { elt: button, xhr: auditXhr });
  fire("htmx:afterSettle", { xhr: { status: 200 } }); // a poll settles while the audit request is in flight
  assert.equal(out.textContent, "", "an unrelated settle reports nothing");

  sha = "bbb"; // the audit response brings a different record
  fire("htmx:afterSettle", { xhr: auditXhr });
  assert.equal(out.tone, "bad", "the audit request's own settle compares against the record it started from");

  // A failed audit request leaves no pending check behind for the next unrelated settle.
  out.textContent = ""; out.tone = "";
  fire("htmx:beforeRequest", { elt: button, xhr: { status: 0 } });
  fire("htmx:afterSettle", { xhr: { status: 200 } });
  assert.equal(out.textContent, "");
});
