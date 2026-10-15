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

test("weave-json sends {} for a POST form with no fields, not an empty body", () => {
  assert.deepEqual(encode([]), {});
});

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
  fire("htmx:beforeSwap", { target: oldMain, shouldSwap: true });
  fire("htmx:oobBeforeSwap", { target: oobTarget });
  fire("htmx:oobAfterSwap", { target: oobTarget });
  const newMain = fakeView("view-runs", false, 0);
  els["view-runs"] = newMain;
  els["view-runs-log"] = newMain.log;
  fire("htmx:afterSettle", {});

  assert.equal(newMain.details.open, true, "the fresh <details data-keep> keeps the operator's open state");
  assert.equal(newMain.log.scrollTop, 300, "the fresh [data-keep-scroll] keeps its scroll position");
});

test("a beforeSwap that is not followed by a swap (204) leaves no snapshot for a later settle to replay", () => {
  const els: Record<string, unknown> = {};
  const on: Record<string, Handler[]> = {};
  loadApp({ getElementById: (id: string) => els[id] ?? null, querySelector: () => null, title: "weave" }, on);
  const fire = (name: string, detail: unknown): void => (on[name] ?? []).forEach((h) => h({ detail }));

  // The operator has the details open and the log scrolled up when an action answers 204.
  const view = fakeView("view-runs", true, 300);
  els["view-runs"] = view;
  els["view-runs-log"] = view.log;
  fire("htmx:beforeSwap", { xhr: { status: 204 }, target: view, shouldSwap: false });

  // Afterwards the operator closes the details and scrolls; then an unrelated swap settles.
  view.details.open = false;
  view.log.scrollTop = 500;
  const other = { id: "weave-count", querySelectorAll: () => [] };
  els["weave-count"] = other;
  fire("htmx:beforeSwap", { xhr: { status: 200 }, target: other, shouldSwap: true });
  fire("htmx:afterSettle", { xhr: { status: 200 } });

  assert.equal(view.details.open, false, "the operator's own close is not undone by a stale snapshot");
  assert.equal(view.log.scrollTop, 500, "the operator's own scroll is not undone by a stale snapshot");
});

test("an OOB #weave-error from a 2xx response stays shown; the next successful request clears it", () => {
  const on: Record<string, Handler[]> = {};
  const err = { id: "weave-error", hidden: false, cleared: 0, replaceChildren() { this.cleared++; } };
  loadApp({ getElementById: (id: string) => (id === "weave-error" ? err : null), title: "weave" }, on);
  const fire = (name: string, detail: unknown): void => (on[name] ?? []).forEach((h) => h({ detail }));

  // htmx 2.0.11: htmx:oobAfterSwap's detail is {shouldSwap, target, fragment} — no xhr.
  const xhr1 = {};
  fire("htmx:beforeRequest", { xhr: xhr1, elt: null });
  fire("htmx:beforeSwap", { xhr: xhr1, target: {} });
  fire("htmx:oobAfterSwap", { shouldSwap: true, target: err, fragment: {} });
  fire("htmx:afterRequest", { xhr: xhr1, successful: true, elt: null });
  assert.equal(err.hidden, false, "the error this response just swapped in is kept");
  assert.equal(err.cleared, 0);

  const xhr2 = {};
  fire("htmx:beforeRequest", { xhr: xhr2, elt: null });
  fire("htmx:afterRequest", { xhr: xhr2, successful: true, elt: null });
  assert.equal(err.hidden, true, "a later successful request clears the stale error");
  assert.equal(err.cleared, 1);
});

test("a request sent before the failing one, finishing after it, does not clear the newer #weave-error", () => {
  const on: Record<string, Handler[]> = {};
  const err = { id: "weave-error", hidden: true, cleared: 0, replaceChildren() { this.cleared++; } };
  loadApp({ getElementById: (id: string) => (id === "weave-error" ? err : null), title: "weave" }, on);
  const fire = (name: string, detail: unknown): void => (on[name] ?? []).forEach((h) => h({ detail }));

  const load = {}, action = {};
  fire("htmx:beforeRequest", { xhr: load, elt: null }); // a view's load GET is in flight
  fire("htmx:beforeRequest", { xhr: action, elt: null }); // the operator's action fails…
  fire("htmx:beforeSwap", { xhr: action, target: {} });
  fire("htmx:oobAfterSwap", { shouldSwap: true, target: err, fragment: {} }); // …into #weave-error
  err.hidden = false;
  fire("htmx:afterRequest", { xhr: action, successful: false, elt: null });

  fire("htmx:afterRequest", { xhr: load, successful: true, elt: null }); // the earlier load finishes late
  assert.equal(err.hidden, false, "a request sent before the failure is not a later request");
  assert.equal(err.cleared, 0);

  const next = {};
  fire("htmx:beforeRequest", { xhr: next, elt: null });
  fire("htmx:afterRequest", { xhr: next, successful: true, elt: null });
  assert.equal(err.hidden, true, "a request sent after the failure clears it");
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

test("a failed audit check does not report that the log still gives exactly this record", () => {
  const on: Record<string, Handler[]> = {};
  const out = { textContent: "", tone: "", setAttribute(a: string, v: string) { if (a === "data-tone") this.tone = v; } };
  const shaEl = { getAttribute: (a: string) => (a === "data-audit-sha" ? "aaa" : null) };
  loadApp({
    getElementById: () => null,
    title: "weave",
    querySelector: (sel: string) => (sel === "#view-audit [data-audit-sha]" ? shaEl : sel === "#view-audit [data-audit-result]" ? out : null),
  }, on);
  const fire = (name: string, detail: unknown): void => (on[name] ?? []).forEach((h) => h({ detail }));
  const button = { hasAttribute: (a: string) => a === "data-audit-check", getAttribute: () => null };

  // The 500 error is swapped (htmx config swaps 4xx/5xx) elsewhere, so #view-audit and its sha are unchanged.
  const failed = { status: 500 };
  fire("htmx:beforeRequest", { elt: button, xhr: failed });
  fire("htmx:afterSettle", { xhr: failed });
  assert.equal(out.textContent, "", "a failed check gives no verdict");
  assert.equal(out.tone, "");
});

test("an audit check whose response is not swapped (204) leaves no pending check to give a verdict later", () => {
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

  const noContent = { status: 204 };
  fire("htmx:beforeRequest", { elt: button, xhr: noContent });
  fire("htmx:beforeSwap", { xhr: noContent, shouldSwap: false }); // htmx skips the swap, so no settle follows
  fire("htmx:afterRequest", { xhr: noContent, successful: true, elt: button });

  sha = "bbb"; // the operator picks a new selection
  fire("htmx:afterSettle", { xhr: { status: 200 } });
  fire("htmx:afterSettle", { xhr: noContent });
  assert.equal(out.textContent, "", "no check was run to completion, so no verdict is shown");
  assert.equal(out.tone, "");
});

test("a failed submit keeps the form dirty, so the view's next poll does not wipe the unsent draft", () => {
  const on: Record<string, Handler[]> = {};
  const docOn: Record<string, Handler[]> = {};
  const attrs: Record<string, string> = {};
  const form = {
    tagName: "FORM",
    setAttribute: (a: string, v: string) => void (attrs[a] = v),
    removeAttribute: (a: string) => void delete attrs[a],
  };
  const input = { tagName: "TEXTAREA", closest: (sel: string) => (sel === "form" ? form : null) };
  const button = { tagName: "BUTTON" };
  const view = { id: "view-work", contains: () => true, querySelector: (sel: string) => (sel === "form[data-dirty]" && "data-dirty" in attrs ? form : null) };
  loadApp({
    getElementById: () => null,
    title: "weave",
    activeElement: button, // the operator clicked submit, so focus is on a BUTTON, not in a field
    addEventListener: (n: string, h: Handler) => void (docOn[n] ??= []).push(h),
  }, on);
  const fire = (name: string, detail: unknown): void => (on[name] ?? []).forEach((h) => h({ detail }));
  const poll = (): boolean => {
    let held = false;
    (on["htmx:beforeRequest"] ?? []).forEach((h) => h({ detail: { elt: view, xhr: {}, requestConfig: { verb: "get" } }, preventDefault: () => { held = true; } }));
    return held;
  };

  (docOn["input"] ?? []).forEach((h) => h({ target: input })); // the operator types a draft, then submits
  const post = {};
  fire("htmx:beforeRequest", { elt: form, xhr: post, requestConfig: { verb: "post" } });
  fire("htmx:afterRequest", { elt: form, xhr: post, successful: false });
  assert.equal(poll(), true, "a failed submit leaves the draft unsent, so the poll is held");

  const retry = {};
  fire("htmx:beforeRequest", { elt: form, xhr: retry, requestConfig: { verb: "post" } });
  fire("htmx:afterRequest", { elt: form, xhr: retry, successful: true });
  assert.equal(poll(), false, "once the submit succeeds the form is clean and the poll goes ahead");
});

test("a running duration (data-fmt=dur, no data-to) counts up to now, not from 1970", () => {
  const docOn: Record<string, Handler[]> = {};
  const fakeTime = (attrs: Record<string, string>) => ({
    textContent: "",
    getAttribute: (a: string) => attrs[a] ?? null,
    setAttribute: noopFn,
    removeAttribute: noopFn,
  });
  const started = Date.now() - 5 * 60000;
  const running = fakeTime({ "data-ts": String(started), "data-fmt": "dur" });
  const emptyTo = fakeTime({ "data-ts": String(started), "data-fmt": "dur", "data-to": "" });
  const finished = fakeTime({ "data-ts": String(started), "data-fmt": "dur", "data-to": String(started + 2 * 3600000) });
  loadApp({
    getElementById: () => null,
    title: "weave",
    addEventListener: (n: string, h: Handler) => void (docOn[n] ??= []).push(h),
    querySelectorAll: (sel: string) => (sel === "time[data-ts]" ? [running, emptyTo, finished] : []),
  });
  (docOn["DOMContentLoaded"] ?? []).forEach((h) => h({}));

  assert.equal(running.textContent, "5m", "no data-to: measured up to now");
  assert.equal(emptyTo.textContent, "5m", "an empty data-to is the same as none");
  assert.equal(finished.textContent, "2h", "a data-to still ends the duration");
});

test("a time with an empty data-ts is skipped, not shown as 1 Jan 1970", () => {
  const docOn: Record<string, Handler[]> = {};
  const fakeTime = (attrs: Record<string, string>) => {
    const set: Record<string, string> = {};
    return {
      textContent: "",
      set,
      getAttribute: (a: string) => attrs[a] ?? null,
      setAttribute: (a: string, v: string) => void (set[a] = v),
      removeAttribute: noopFn,
    };
  };
  const empty = fakeTime({ "data-ts": "" });
  const blank = fakeTime({ "data-ts": " " });
  const until = fakeTime({ "data-ts": "", "data-fmt": "until" });
  loadApp({
    getElementById: () => null,
    title: "weave",
    addEventListener: (n: string, h: Handler) => void (docOn[n] ??= []).push(h),
    querySelectorAll: (sel: string) => (sel === "time[data-ts]" ? [empty, blank, until] : []),
  });
  (docOn["DOMContentLoaded"] ?? []).forEach((h) => h({}));

  for (const t of [empty, blank, until]) {
    assert.equal(t.textContent, "", "an empty data-ts renders nothing");
    assert.deepEqual(t.set, {}, "no title or tone is set");
  }
});
