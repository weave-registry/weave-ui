/**
 * assets-src/app.js under weave-ui's own server (weave ADR-0245 §5): every state-changing htmx request carries the
 * session's CSRF token (read from weave-ui's `wui_csrf` cookie, sent as X-CSRF-Token), and the pages keep their own
 * URLs — links are rewritten to the static shells only when the page IS a static shell (/ui/assets/pages/…).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ROOT } from "./helpers.js";

type Handler = (evt: unknown) => void;
interface Ext {
  onEvent?: (name: string, evt: unknown) => unknown;
}
interface Anchor {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  href: string;
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
}

const ORIGIN = "http://127.0.0.1:8790";

function anchor(path: string): Anchor {
  const a: Anchor = {
    origin: ORIGIN,
    pathname: path,
    search: "",
    hash: "",
    href: path,
    getAttribute: (n) => (n === "href" ? a.href : null),
    setAttribute: (n, v) => {
      if (n === "href") a.href = v;
    },
  };
  return a;
}

function load(opts: { pathname: string; cookie?: string; anchors?: Anchor[] }): { exts: Record<string, Ext>; on: Record<string, Handler[]> } {
  const exts: Record<string, Ext> = {};
  const on: Record<string, Handler[]> = {};
  const noop = (): void => {};
  const anchors = opts.anchors ?? [];
  const body = {
    getAttribute: (n: string) => (n === "data-shell" ? "home" : null),
    hasAttribute: (n: string) => n === "data-shell",
    setAttribute: noop,
    dataset: {},
    querySelectorAll: () => [],
    addEventListener: noop,
    closest: () => null,
  };
  const loc = { search: "", pathname: opts.pathname, hash: "", origin: ORIGIN };
  const document = {
    addEventListener: noop,
    querySelectorAll: (sel: string) => (sel === "a[href]" ? anchors : []),
    querySelector: () => null,
    body,
    documentElement: body,
    activeElement: null,
    readyState: "loading",
    cookie: opts.cookie ?? "",
  };
  const htmx = { defineExtension: (n: string, e: Ext) => void (exts[n] = e), on: (n: string, h: Handler) => void (on[n] ??= []).push(h), process: noop, config: {} };
  const sandbox = { htmx, document, window: { addEventListener: noop, location: loc, confirm: () => true, document, htmx }, location: loc, setInterval: noop, clearInterval: noop, setTimeout: noop, Intl, Date };
  vm.runInNewContext(readFileSync(join(ROOT, "assets-src", "app.js"), "utf8"), sandbox, { filename: "app.js" });
  return { exts, on };
}

/** Run a configRequest through weave-json and every htmx:configRequest handler, as htmx would; return its headers. */
function configRequest(app: ReturnType<typeof load>, verb: string): Record<string, string> {
  const detail = { headers: {} as Record<string, string>, verb, path: verb === "get" ? "/ui/f/home" : "/ui/a/grant", parameters: new FormData(), elt: null };
  const evt = { detail, preventDefault: () => {} };
  app.exts["weave-json"]?.onEvent?.("htmx:configRequest", evt);
  for (const h of app.on["htmx:configRequest"] ?? []) h(evt);
  return detail.headers;
}

test("a POST carries the session's CSRF token from the wui_csrf cookie as X-CSRF-Token", () => {
  const app = load({ pathname: "/", cookie: "other=1; wui_csrf=tok-AbC_123; x=y" });
  const h = configRequest(app, "post");
  assert.equal(h["X-CSRF-Token"], "tok-AbC_123");
  assert.equal(h["Content-Type"], "application/json", "still JSON");
});

test("a percent-encoded token cookie is decoded; no cookie means no header", () => {
  assert.equal(configRequest(load({ pathname: "/", cookie: "wui_csrf=a%2Bb%3D" }), "post")["X-CSRF-Token"], "a+b=");
  assert.equal(configRequest(load({ pathname: "/", cookie: "" }), "post")["X-CSRF-Token"], undefined);
  assert.equal(configRequest(load({ pathname: "/", cookie: "not_wui_csrf=zzz" }), "post")["X-CSRF-Token"], undefined, "an exact cookie name, not a suffix");
});

test("a GET (a fragment read) does not carry the token", () => {
  assert.equal(configRequest(load({ pathname: "/", cookie: "wui_csrf=t" }), "get")["X-CSRF-Token"], undefined);
});

test("served at its own URL (weave-ui's server), a page keeps its links as they are", () => {
  const work = anchor("/work");
  const task = anchor("/task");
  load({ pathname: "/", anchors: [work, task] });
  assert.equal(work.href, "/work");
  assert.equal(task.href, "/task");
  const audit = anchor("/audit");
  load({ pathname: "/machines", anchors: [audit] });
  assert.equal(audit.href, "/audit");
});

test("opened as a static shell (/ui/assets/pages/…), links still go to the sibling shells", () => {
  const work = anchor("/work");
  load({ pathname: "/ui/assets/pages/home.html", anchors: [work] });
  assert.equal(work.href, "/ui/assets/pages/work.html");
});
