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

function loadApp(): Record<string, Ext> {
  const exts: Record<string, Ext> = {};
  const noop = (): void => {};
  const el = { getAttribute: () => null, setAttribute: noop, dataset: {}, querySelectorAll: () => [], addEventListener: noop, closest: () => null };
  const sandbox = {
    htmx: { defineExtension: (n: string, e: Ext) => void (exts[n] = e), on: noop, process: noop, config: {} },
    document: { addEventListener: noop, querySelectorAll: () => [], querySelector: () => null, body: el, documentElement: el, activeElement: null, readyState: "loading" },
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
