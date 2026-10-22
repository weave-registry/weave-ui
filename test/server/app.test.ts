/**
 * #8 / weave ADR-0245 §2, §5 — weave-ui's HTTP server: the eight pages at their own URLs, fragments and actions
 * rendered from view models fetched upstream, assets, the browser SSE stream, the file route and /health — every
 * response with the CSP and no CORS, every request but /health admitted by address trust, every write held to
 * HX-Request + JSON + same origin + the session's CSRF token, and the fleet action refused as `weave halt|resume`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp, renderCtx, type AppDeps } from "../../src/server/app.js";
import { UpstreamError } from "../../src/server/weave-client.js";
import { csrfToken } from "../../src/server/security.js";
import { parseCidr } from "../../src/server/trust.js";
import { templates } from "../../src/templates/index.js";
import { ROOT } from "../helpers.js";

const SECRET = "console-secret-0123456789abcdefghijklmnop";
const KEY = "session-key-for-tests";
const PAGES = ["home", "work", "control", "factory", "machines", "team", "task", "audit"] as const;
const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));

/** A dist/assets stand-in: one shell per page, app.js, weave.css, favicon.svg. */
function assetsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wui-assets-"));
  mkdirSync(join(dir, "pages"));
  for (const p of PAGES) writeFileSync(join(dir, "pages", `${p}.html`), `<!doctype html><title>${p}</title><body data-shell="${p}">shell:${p}</body>`);
  writeFileSync(join(dir, "app.js"), "/* app */");
  writeFileSync(join(dir, "weave.css"), "body{}");
  writeFileSync(join(dir, "favicon.svg"), "<svg/>");
  return dir;
}
const ASSETS = assetsDir();

interface Calls {
  views: { name: string; query: Record<string, string> }[];
  actions: { verb: string; body: unknown; opts: unknown }[];
  files: { path: string; task: string | undefined }[];
  attached: number;
}

function fakeClient(over: Partial<{ version: string; viewError: UpstreamError; actionError: UpstreamError; file: unknown }> = {}): { client: AppDeps["client"]; calls: Calls; hub: AppDeps["hub"] } {
  const calls: Calls = { views: [], actions: [], files: [], attached: 0 };
  const views: Record<string, unknown> = { home: fx("home.full"), work: fx("work.full"), control: fx("control.full"), task: fx("task.working") };
  const client: AppDeps["client"] = {
    view: async (name: string, query?: Readonly<Record<string, string>>) => {
      calls.views.push({ name, query: { ...(query ?? {}) } });
      if (over.viewError) throw over.viewError;
      return { ok: true, api: "1.2", view: views[name] ?? {}, count: 1, note: "" } as never;
    },
    action: async (verb: string, body: unknown, opts?: { onBehalfOf?: string }) => {
      calls.actions.push({ verb, body, opts });
      if (over.actionError) throw over.actionError;
      return { ok: true };
    },
    api: async () => ({ version: over.version ?? "1.2", refresh: { grant: ["home"], yolo: ["home", "control"] } }),
    file: async (path: string, task?: string) => {
      calls.files.push({ path, task });
      return (over.file ?? { path, size: 5, contentType: "text/markdown", text: "hello" }) as never;
    },
  };
  const hub: AppDeps["hub"] = {
    attach: (sink) => {
      calls.attached++;
      sink.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      sink.end();
    },
  };
  return { client, calls, hub };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}

/** Drive the handler with a fake request (a Readable with the IncomingMessage fields the app reads) and capture the reply. */
async function call(
  app: (req: IncomingMessage, res: ServerResponse) => void,
  r: { method?: string; url: string; headers?: Record<string, string>; remote?: string; body?: string },
): Promise<Reply> {
  const req = Readable.from(r.body !== undefined ? [Buffer.from(r.body)] : []) as unknown as IncomingMessage & Record<string, unknown>;
  req.method = r.method ?? "GET";
  req.url = r.url;
  req.headers = { host: "127.0.0.1:8789", ...(r.headers ?? {}) };
  Object.defineProperty(req, "socket", { value: { remoteAddress: r.remote ?? "127.0.0.1" } });
  return new Promise<Reply>((resolve) => {
    const headers: Record<string, string | string[]> = {};
    let status = 200;
    let body = "";
    const closers: (() => void)[] = [];
    const res = {
      statusCode: 200,
      headersSent: false,
      writableLength: 0,
      setHeader(n: string, v: string | string[]) {
        headers[n.toLowerCase()] = v;
        return res;
      },
      getHeader: (n: string) => headers[n.toLowerCase()],
      removeHeader: (n: string) => void delete headers[n.toLowerCase()],
      writeHead(s: number, h?: Record<string, string | string[]>) {
        status = s;
        res.statusCode = s;
        for (const [k, v] of Object.entries(h ?? {})) headers[k.toLowerCase()] = v;
        res.headersSent = true;
        return res;
      },
      write(c: string | Buffer) {
        body += String(c);
        return true;
      },
      end(c?: string | Buffer) {
        if (c !== undefined) body += String(c);
        if (!res.headersSent) status = res.statusCode;
        resolve({ status, headers, body });
        return res;
      },
      on(ev: string, fn: () => void) {
        if (ev === "close") closers.push(fn);
        return res;
      },
      once(ev: string, fn: () => void) {
        return res.on(ev, fn);
      },
      destroy() {
        resolve({ status, headers, body });
      },
    };
    app(req, res as unknown as ServerResponse);
  });
}

const make = (over: Parameters<typeof fakeClient>[0] = {}, trust: string[] = []) => {
  const f = fakeClient(over);
  const app = createApp({
    client: f.client,
    hub: f.hub,
    assetsDir: ASSETS,
    trustCidrs: trust.map(parseCidr),
    sessionKey: KEY,
    weaveUrl: "https://weave.lan:8787",
    insecureUpstream: false,
  });
  return { app, ...f };
};

const cookieValue = (r: Reply, name: string): string | undefined => {
  const raw = r.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  const c = list.find((x) => x.startsWith(`${name}=`));
  return c?.slice(name.length + 1).split(";")[0];
};
const cookieLine = (r: Reply, name: string): string => {
  const raw = r.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  return list.find((x) => x.startsWith(`${name}=`)) ?? "";
};

/** A session: GET / once, then the cookies and token a browser would send back. */
async function session(app: Parameters<typeof call>[0]): Promise<{ cookie: string; token: string; sid: string }> {
  const r = await call(app, { url: "/" });
  const sid = cookieValue(r, "wui_session")!;
  const token = cookieValue(r, "wui_csrf")!;
  return { cookie: `wui_session=${sid}; wui_csrf=${token}`, token, sid };
}

const writeHeaders = (s: { cookie: string; token: string }, extra: Record<string, string> = {}): Record<string, string> => ({
  "hx-request": "true",
  "content-type": "application/json",
  origin: "http://127.0.0.1:8789",
  "sec-fetch-site": "same-origin",
  cookie: s.cookie,
  "x-csrf-token": s.token,
  ...extra,
});

test("/health answers anyone, names the upstream without the secret, and says whether the upstream is insecure", async () => {
  const { app } = make();
  const r = await call(app, { url: "/health", remote: "203.0.113.9", headers: { host: "evil.example.com" } });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body) as { ok: boolean; insecureUpstream: boolean; weave: string };
  assert.equal(j.ok, true);
  assert.equal(j.insecureUpstream, false);
  assert.equal(j.weave, "https://weave.lan:8787");
  assert.ok(!r.body.includes(SECRET));
});

test("an address that is neither loopback nor a --trust-cidr network gets a 403 page saying how to admit it, and nothing goes upstream", async () => {
  const { app, calls } = make();
  for (const url of ["/", "/ui/f/home", "/events", "/file?path=/a"]) {
    const r = await call(app, { url, remote: "203.0.113.9", headers: { host: "bazzite.lan:8789" } });
    assert.equal(r.status, 403, url);
    assert.match(r.body, /--trust-cidr/);
    assert.match(String(r.headers["content-type"]), /^text\/html/);
  }
  assert.equal(calls.views.length + calls.files.length + calls.attached, 0);
});

test("a --trust-cidr network is admitted; a rebinding Host or a cross-site fetch is not, even from loopback", async () => {
  const { app } = make({}, ["192.168.1.0/24"]);
  assert.equal((await call(app, { url: "/", remote: "192.168.1.5", headers: { host: "bazzite.lan:8789" } })).status, 200);
  assert.equal((await call(app, { url: "/", remote: "::ffff:127.0.0.1" })).status, 200);
  assert.equal((await call(app, { url: "/", headers: { host: "evil.example.com:8789" } })).status, 403);
  assert.equal((await call(app, { url: "/", headers: { "sec-fetch-site": "cross-site" } })).status, 403);
});

test("every response carries the CSP and its siblings, and never an Access-Control header", async () => {
  const { app } = make();
  const replies = await Promise.all([
    call(app, { url: "/" }),
    call(app, { url: "/health" }),
    call(app, { url: "/ui/f/home" }),
    call(app, { url: "/nope" }),
    call(app, { url: "/", remote: "203.0.113.9" }),
    call(app, { url: "/ui/assets/app.js" }),
    call(app, { url: "/ui/a/grant", method: "POST", body: "{}" }),
  ]);
  for (const r of replies) {
    assert.match(String(r.headers["content-security-policy"]), /default-src 'none'/);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["x-frame-options"], "DENY");
    assert.ok(!Object.keys(r.headers).some((h) => h.startsWith("access-control-")), "no CORS header");
  }
});

test("each of the eight pages is served at its own URL from its shell; /peers redirects to /machines", async () => {
  const { app } = make();
  const urls: Record<string, string> = { "/": "home", "/work": "work", "/control": "control", "/factory": "factory", "/machines": "machines", "/team": "team", "/task?id=t-1": "task", "/audit": "audit" };
  for (const [url, page] of Object.entries(urls)) {
    const r = await call(app, { url });
    assert.equal(r.status, 200, url);
    assert.match(String(r.headers["content-type"]), /^text\/html/);
    assert.ok(r.body.includes(`shell:${page}`), url);
  }
  const p = await call(app, { url: "/peers?x=1" });
  assert.ok(p.status === 301 || p.status === 302 || p.status === 308, String(p.status));
  assert.equal(p.headers["location"], "/machines?x=1");
});

test("a page sets weave-ui's own session (HttpOnly, SameSite=Strict) and its CSRF token cookie, bound to that session", async () => {
  const { app } = make();
  const r = await call(app, { url: "/" });
  const sid = cookieValue(r, "wui_session");
  const tok = cookieValue(r, "wui_csrf");
  assert.ok(sid && /^[A-Za-z0-9_-]{32,}$/.test(sid), "a random session id");
  assert.match(cookieLine(r, "wui_session"), /HttpOnly/i);
  assert.match(cookieLine(r, "wui_session"), /SameSite=Strict/i);
  assert.match(cookieLine(r, "wui_session"), /Path=\//);
  assert.match(cookieLine(r, "wui_csrf"), /SameSite=Strict/i);
  assert.doesNotMatch(cookieLine(r, "wui_csrf"), /HttpOnly/i, "app.js reads the token");
  assert.equal(tok, csrfToken(KEY, sid!));
  assert.ok(!JSON.stringify(r.headers).includes(SECRET), "no weave credential in any cookie or header");
  const again = await call(app, { url: "/work", headers: { cookie: `wui_session=${sid}; wui_csrf=${tok}` } });
  assert.equal(cookieValue(again, "wui_session"), undefined, "an existing session is kept");
});

test("a weave older than the contract gets a page naming both versions and the fix", async () => {
  const { app } = make({ version: "1.1" });
  const r = await call(app, { url: "/" });
  assert.equal(r.status, 503);
  assert.match(r.body, /1\.1/);
  assert.match(r.body, /1\.2/);
  assert.match(r.body, /weave upgrade/);
});

test("GET /ui/f/<view> renders the view model fetched upstream with that view's template, forwarding the query", async () => {
  const { app, calls } = make();
  const r = await call(app, { url: "/ui/f/home" });
  assert.equal(r.status, 200);
  assert.match(String(r.headers["content-type"]), /^text\/html/);
  assert.ok(r.body.includes('id="view-home"'));
  assert.equal(r.body, templates["home"]!(fx("home.full"), renderCtx("1.2")));
  assert.deepEqual(renderCtx("1.2").nav.map((n) => n.path), ["/", "/work", "/control", "/factory", "/machines", "/team", "/audit"]);
  await call(app, { url: "/ui/f/task?id=t-1&fields=x" });
  assert.deepEqual(calls.views.at(-1), { name: "task", query: { id: "t-1", fields: "x" } });
});

test("an unknown view is a 404 error fragment and nothing goes upstream", async () => {
  const { app, calls } = make();
  for (const url of ["/ui/f/nope", "/ui/f/error", "/ui/f/../health", "/ui/f/HOME", "/ui/f/"]) {
    const r = await call(app, { url });
    assert.equal(r.status, 404, url);
    assert.match(r.body, /id="weave-error"/);
  }
  assert.equal(calls.views.length, 0);
});

test("a weave refusal on a fragment is the error fragment with weave's status; a refused credential says how to fix it", async () => {
  const scope = make({ viewError: new UpstreamError("GET /api/v1/home is outside the console scope", "console-scope", 403, { code: "console-scope", commands: [{ run: "weave status", ready: true }] }) });
  const r = await call(scope.app, { url: "/ui/f/home" });
  assert.equal(r.status, 403);
  assert.match(r.body, /outside the console scope/);
  assert.match(r.body, /data-code="console-scope"/);
  const cred = make({ viewError: new UpstreamError("no credential", "credential-refused", 401) });
  const c = await call(cred.app, { url: "/ui/f/home" });
  assert.equal(c.status, 401);
  assert.match(c.body, /weave refused the console credential/);
  assert.match(c.body, /weave secret set --generate WEAVE_CONSOLE_SECRET/);
  const down = make({ viewError: new UpstreamError("weave at https://weave.lan:8787 is unreachable: ECONNREFUSED", "upstream-unreachable", 0) });
  const d = await call(down.app, { url: "/ui/f/home" });
  assert.equal(d.status, 502);
  assert.match(d.body, /unreachable/);
});

test("POST /ui/a/<verb> with HX-Request, JSON, same origin and the session's token takes the action and answers the refresh views", async () => {
  const { app, calls } = make();
  const s = await session(app);
  const r = await call(app, { method: "POST", url: "/ui/a/grant", headers: writeHeaders(s), body: JSON.stringify({ approve: "g-1" }) });
  assert.equal(r.status, 200);
  assert.equal(calls.actions.length, 1);
  assert.equal(calls.actions[0]?.verb, "grant");
  assert.deepEqual(calls.actions[0]?.body, { approve: "g-1" });
  assert.ok(r.body.includes('id="view-home"'), "the x-refresh views, rendered");
  const y = await call(app, { method: "POST", url: "/ui/a/yolo", headers: writeHeaders(s), body: JSON.stringify({ on: true }) });
  assert.ok(y.body.includes('id="view-home"') && y.body.includes('id="view-control"'));
});

test("a write without HX-Request, without or with a wrong token, from another origin or site, or not JSON is refused before any action", async () => {
  const { app, calls } = make();
  const s = await session(app);
  const body = JSON.stringify({ approve: "g-1" });
  const cases: [Record<string, string>, number][] = [
    [writeHeaders(s, { "hx-request": "" }), 403],
    [writeHeaders(s, { "x-csrf-token": "" }), 403],
    [writeHeaders(s, { "x-csrf-token": "AAAA" + s.token.slice(4) }), 403],
    [writeHeaders(s, { cookie: "" }), 403],
    [writeHeaders(s, { origin: "http://evil.example.com" }), 403],
    [writeHeaders(s, { "sec-fetch-site": "cross-site" }), 403],
    [writeHeaders(s, { "content-type": "application/x-www-form-urlencoded" }), 415],
  ];
  for (const [headers, status] of cases) {
    const r = await call(app, { method: "POST", url: "/ui/a/grant", headers, body });
    assert.equal(r.status, status, JSON.stringify(headers));
    assert.match(r.body, /id="weave-error"/);
  }
  assert.equal(calls.actions.length, 0);
});

test("the fleet action is refused by weave-ui itself, naming weave halt / weave resume; an unknown verb is 404", async () => {
  const { app, calls } = make();
  const s = await session(app);
  const f = await call(app, { method: "POST", url: "/ui/a/fleet", headers: writeHeaders(s), body: JSON.stringify("halt") });
  assert.equal(f.status, 403);
  assert.match(f.body, /weave halt/);
  assert.match(f.body, /weave resume/);
  const u = await call(app, { method: "POST", url: "/ui/a/nope", headers: writeHeaders(s), body: "{}" });
  assert.equal(u.status, 404);
  assert.equal(calls.actions.length, 0);
});

test("a body over 64 KiB is 413, a body that is not JSON is 400, and GET on an action is 405", async () => {
  const { app, calls } = make();
  const s = await session(app);
  assert.equal((await call(app, { method: "POST", url: "/ui/a/chat", headers: writeHeaders(s), body: JSON.stringify({ text: "x".repeat(70 * 1024) }) })).status, 413);
  assert.equal((await call(app, { method: "POST", url: "/ui/a/chat", headers: writeHeaders(s), body: "{not json" })).status, 400);
  assert.equal((await call(app, { url: "/ui/a/grant" })).status, 405);
  assert.equal(calls.actions.length, 0);
});

test("a weave refusal of an action is the error fragment with weave's status", async () => {
  const { app } = make({ actionError: new UpstreamError("role refused: no such tool", "action-refused", 422, { code: "action-refused", commands: [] }) });
  const s = await session(app);
  const r = await call(app, { method: "POST", url: "/ui/a/role", headers: writeHeaders(s), body: "{}" });
  assert.equal(r.status, 422);
  assert.match(r.body, /no such tool/);
});

test("assets are served from the assets directory with their content type; nothing outside it", async () => {
  const { app } = make();
  const js = await call(app, { url: "/ui/assets/app.js" });
  assert.equal(js.status, 200);
  assert.match(String(js.headers["content-type"]), /javascript/);
  assert.match(String((await call(app, { url: "/ui/assets/weave.css" })).headers["content-type"]), /^text\/css/);
  assert.match(String((await call(app, { url: "/ui/assets/favicon.svg" })).headers["content-type"]), /^image\/svg\+xml/);
  assert.equal((await call(app, { url: "/ui/assets/pages/home.html" })).status, 200);
  for (const url of ["/ui/assets/../app.ts", "/ui/assets/%2e%2e/%2e%2e/etc/passwd", "/ui/assets/missing.js", "/ui/assets/", "/ui/assets/.hidden"]) {
    assert.equal((await call(app, { url })).status, 404, url);
  }
});

test("GET /events attaches the browser to the changes hub, with the security headers", async () => {
  const { app, calls } = make();
  const r = await call(app, { url: "/events" });
  assert.equal(calls.attached, 1);
  assert.match(String(r.headers["content-security-policy"]), /default-src 'none'/);
});

test("GET /file shows a text file escaped in a page, offers a binary one as a download, and needs a path", async () => {
  const t = make({ file: { path: "/w/a.md", size: 30, contentType: "text/markdown", text: "<script>alert(1)</script> & co" } });
  const r = await call(t.app, { url: "/file?path=%2Fw%2Fa.md&task=t-1" });
  assert.deepEqual(t.calls.files, [{ path: "/w/a.md", task: "t-1" }]);
  assert.equal(r.status, 200);
  assert.match(String(r.headers["content-type"]), /^text\/html/);
  assert.ok(r.body.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co"));
  assert.ok(!r.body.includes("<script>alert"));
  const b = make({ file: { path: "/w/x\"y.bin", size: 3, contentType: "image/png", base64: Buffer.from([1, 2, 3]).toString("base64") } });
  const d = await call(b.app, { url: "/file?path=%2Fw%2Fx.bin" });
  assert.equal(b.calls.files[0]?.task, undefined);
  assert.equal(d.status, 200);
  assert.equal(d.headers["content-type"], "application/octet-stream");
  assert.match(String(d.headers["content-disposition"]), /^attachment; filename="[A-Za-z0-9._-]+"$/);
  assert.equal(d.body, Buffer.from([1, 2, 3]).toString());
  assert.equal((await call(b.app, { url: "/file" })).status, 400);
});

test("an unknown path is 404", async () => {
  const { app } = make();
  assert.equal((await call(app, { url: "/knowledge" })).status, 404);
  assert.equal((await call(app, { url: "/api/v1/home" })).status, 404, "weave-ui is not a proxy to weave's API");
});
