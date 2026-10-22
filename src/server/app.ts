/**
 * weave-ui's HTTP request handler (weave ADR-0245 §2, §3, §5): the eight pages at their own URLs, fragments and
 * actions rendered from view models fetched upstream, assets, the browser SSE stream, the file route and /health.
 * Every response carries the CSP and no CORS; every request but /health is admitted by address trust (§5); every
 * write is held to HX-Request + JSON + same origin + the session's CSRF token; the fleet action is refused (§3).
 */
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FixCommand, NavEntry, RenderCtx, Resolution } from "../../contract/console-views-v1.js";
import { html, toHtml } from "../html.js";
import type { SafeHtml } from "../html.js";
import { templates } from "../templates/index.js";
import { KNOWN_VERBS } from "../ui/actions.js";
import { checkCsrf, csrfToken, securityHeaders } from "./security.js";
import { requestTrusted } from "./trust.js";
import type { Cidr } from "./trust.js";
import type { SseSink } from "./changes.js";
import { UpstreamError } from "./weave-client.js";
import type { WeaveClient } from "./weave-client.js";

export interface AppDeps {
  client: Pick<WeaveClient, "view" | "action" | "api" | "file">;
  hub: { attach(sink: SseSink): void };
  assetsDir: string;
  trustCidrs: readonly Cidr[];
  sessionKey: string;
  weaveUrl: string;
  insecureUpstream: boolean;
  log?: (line: string) => void;
}

/** weave's core nav, as scripts/build.ts's CORE_NAV. */
const CORE_NAV: readonly NavEntry[] = [
  { key: "home", label: "Home", path: "/" },
  { key: "work", label: "Work", path: "/work" },
  { key: "control", label: "Control", path: "/control" },
  { key: "factory", label: "Factory", path: "/factory" },
  { key: "machines", label: "Machines", path: "/machines" },
  { key: "team", label: "Team", path: "/team" },
  { key: "audit", label: "Audit", path: "/audit" },
];

export function renderCtx(api: string): RenderCtx {
  return { api, nav: CORE_NAV };
}

/** The view contract this weave-ui needs. */
const REQUIRED = "1.2";
const API_TTL_MS = 60_000;
const BODY_LIMIT = 65536;

const PAGES: Readonly<Record<string, string>> = {
  "/": "home",
  "/work": "work",
  "/control": "control",
  "/factory": "factory",
  "/machines": "machines",
  "/team": "team",
  "/task": "task",
  "/audit": "audit",
};
const FRAGMENTS: ReadonlySet<string> = new Set(["home", "work", "control", "machines", "fleet", "team", "task", "audit", "factory"]);

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
const ASSET_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
};
const HTML_TYPE = "text/html; charset=utf-8";

type ApiInfo = Awaited<ReturnType<WeaveClient["api"]>>;

interface ErrorParts {
  status: number;
  message: string;
  code: string;
  resolution: Resolution;
}

class RequestRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function versionBelow(have: string, need: string): boolean {
  const parse = (v: string): [number, number] => {
    const [a, b] = v.split(".");
    return [Number(a) || 0, Number(b) || 0];
  };
  const [hm, hn] = parse(have);
  const [nm, nn] = parse(need);
  return hm < nm || (hm === nm && hn < nn);
}

function page(title: string, body: SafeHtml): string {
  return toHtml(html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`);
}

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== "" && !out.has(name)) out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

function sessionOf(req: IncomingMessage): string | undefined {
  const sid = parseCookies(req.headers.cookie).get("wui_session");
  return sid !== undefined && SESSION_ID.test(sid) ? sid : undefined;
}

function headerString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v.join(", ") : v;
}

function errorParts(e: unknown): ErrorParts {
  if (e instanceof RequestRefused) return { status: e.status, message: e.message, code: e.code, resolution: { code: e.code, commands: [] } };
  if (e instanceof UpstreamError) {
    if (e.code === "credential-refused") {
      const commands: FixCommand[] = [
        { run: "weave secret set --generate WEAVE_CONSOLE_SECRET", ready: true },
        { run: "weave secret exec WEAVE_CONSOLE_SECRET -- weave-ui", ready: false, why: "restart weave-ui with the new value" },
      ];
      return { status: 401, message: "weave refused the console credential", code: e.code, resolution: { code: e.code, commands } };
    }
    return { status: e.status || 502, message: e.message, code: e.code, resolution: e.resolution ?? { code: e.code, commands: [] } };
  }
  return { status: 502, message: e instanceof Error ? e.message : String(e), code: "upstream-error", resolution: { code: "upstream-error", commands: [] } };
}

export function createApp(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const log = (line: string): void => {
    if (deps.log === undefined) return;
    try {
      deps.log(line);
    } catch {
      // logging must never break a reply
    }
  };
  const assetsRoot = resolve(deps.assetsDir);

  let apiCache: { at: number; info: ApiInfo } | undefined;
  const api = async (): Promise<ApiInfo> => {
    const now = Date.now();
    if (apiCache !== undefined && now - apiCache.at < API_TTL_MS) return apiCache.info;
    const info = await deps.client.api();
    apiCache = { at: now, info };
    return info;
  };
  const version = (): string => apiCache?.info.version ?? REQUIRED;

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.statusCode = status;
    res.setHeader("content-type", type);
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    res.end(body);
  };

  const errorFragment = (p: ErrorParts): string =>
    templates["error"]!({ ok: false, error: p.message, code: p.code, resolution: p.resolution }, renderCtx(version()));

  const sendError = (res: ServerResponse, p: ErrorParts): void => send(res, p.status, HTML_TYPE, errorFragment(p));

  const refuse = (res: ServerResponse, status: number, code: string, message: string, commands: readonly FixCommand[] = []): void =>
    sendError(res, { status, code, message, resolution: { code, commands } });

  const failed = (what: string, e: unknown): ErrorParts => {
    const p = errorParts(e);
    log(`weave-ui: ${what} failed: ${p.code} (${p.status}): ${p.message}`);
    return p;
  };

  const htmlPage = (res: ServerResponse, status: number, title: string, body: SafeHtml): void => send(res, status, HTML_TYPE, page(title, body));

  /** Fetch a view and render it; a failure becomes its error fragment. */
  const renderView = async (name: string, query: Record<string, string>): Promise<{ status: number; body: string }> => {
    let env;
    try {
      env = await deps.client.view(name, query);
    } catch (e) {
      const p = failed(`view ${name}`, e);
      return { status: p.status, body: errorFragment(p) };
    }
    try {
      return { status: 200, body: templates[name]!(env.view, renderCtx(version())) };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`weave-ui: render ${name} failed: ${message}`);
      return { status: 500, body: errorFragment({ status: 500, message: `the ${name} view could not be rendered`, code: "render-failed", resolution: { code: "render-failed", commands: [] } }) };
    }
  };

  const servePage = async (req: IncomingMessage, res: ServerResponse, name: string): Promise<void> => {
    let info: ApiInfo | undefined;
    try {
      info = await api();
    } catch (e) {
      log(`weave-ui: version check skipped: ${errorParts(e).message}`);
    }
    if (info !== undefined && versionBelow(info.version, REQUIRED)) {
      htmlPage(res, 503, "weave is too old", html`<h1>weave is too old</h1><p>weave serves view contract ${info.version}; this weave-ui needs ${REQUIRED}.</p><p>To fix it, run: <code>weave upgrade</code></p>`);
      return;
    }
    let shell: string;
    try {
      shell = await readFile(resolve(assetsRoot, "pages", `${name}.html`), "utf8");
    } catch (e) {
      log(`weave-ui: page ${name} missing: ${e instanceof Error ? e.message : String(e)}`);
      htmlPage(res, 500, "page missing", html`<h1>page missing</h1><p>weave-ui could not read its ${name} page; rebuild weave-ui.</p>`);
      return;
    }
    if (sessionOf(req) === undefined) {
      const id = randomBytes(32).toString("base64url");
      const secure = (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true ? "; Secure" : "";
      res.setHeader("set-cookie", [
        `wui_session=${id}; Path=/; HttpOnly; SameSite=Strict${secure}`,
        `wui_csrf=${csrfToken(deps.sessionKey, id)}; Path=/; SameSite=Strict${secure}`,
      ]);
    }
    send(res, 200, HTML_TYPE, shell);
  };

  const readBody = async (req: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
      total += buf.length;
      if (total > BODY_LIMIT) throw new RequestRefused(413, "bad-body", `the request body is over ${BODY_LIMIT} bytes`);
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString("utf8");
  };

  const action = async (req: IncomingMessage, res: ServerResponse, verb: string): Promise<void> => {
    if (!KNOWN_VERBS.includes(verb)) return refuse(res, 404, "unknown-action", `${verb} is not an action this console can send`);
    if (verb === "fleet") {
      return refuse(res, 403, "console-scope", "halt and resume are not the console's — run weave halt or weave resume on the command line", [
        { run: "weave halt", ready: true },
        { run: "weave resume", ready: true },
      ]);
    }
    if (req.headers["hx-request"] !== "true") return refuse(res, 403, "hx-request-required", "an action must be sent by the console (HX-Request: true)");
    const media = (headerString(req.headers["content-type"]) ?? "").split(";")[0]!.trim().toLowerCase();
    if (media !== "application/json") return refuse(res, 415, "json-required", "an action's body must be application/json");
    const sid = sessionOf(req);
    if (sid === undefined) return refuse(res, 403, "csrf", "csrf: no console session; reload the page");
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = headerString(v);
    const csrf = checkCsrf({ method: req.method ?? "POST", headers, key: deps.sessionKey, sessionId: sid });
    if (!csrf.ok) return refuse(res, 403, "csrf", csrf.reason);

    let body: unknown;
    try {
      const text = await readBody(req);
      try {
        body = JSON.parse(text);
      } catch {
        throw new RequestRefused(400, "bad-body", "the request body is not JSON");
      }
    } catch (e) {
      return sendError(res, errorParts(e));
    }

    try {
      await deps.client.action(verb, body);
    } catch (e) {
      return sendError(res, failed(`action ${verb}`, e));
    }

    let refresh: readonly string[] = [];
    try {
      refresh = (await api()).refresh[verb] ?? [];
    } catch (e) {
      log(`weave-ui: refresh list for ${verb} unavailable: ${errorParts(e).message}`);
    }
    const parts: string[] = [];
    for (const name of refresh) {
      if (!FRAGMENTS.has(name)) continue;
      parts.push((await renderView(name, {})).body);
    }
    send(res, 200, HTML_TYPE, parts.join(""));
  };

  const asset = async (res: ServerResponse, rel: string): Promise<void> => {
    const notFound = (): void => htmlPage(res, 404, "not found", html`<h1>not found</h1>`);
    if (!ASSET_PATH.test(rel)) return notFound();
    const full = resolve(assetsRoot, rel);
    if (!full.startsWith(assetsRoot + sep)) return notFound();
    try {
      if (!(await stat(full)).isFile()) return notFound();
      const data = await readFile(full);
      send(res, 200, CONTENT_TYPES[extname(full).toLowerCase()] ?? "application/octet-stream", data);
    } catch {
      notFound();
    }
  };

  const file = async (res: ServerResponse, url: URL): Promise<void> => {
    const path = url.searchParams.get("path");
    if (path === null || path === "") return htmlPage(res, 400, "no path", html`<h1>no path</h1><p>/file needs ?path=&lt;path&gt;.</p>`);
    const task = url.searchParams.get("task") || undefined;
    let f;
    try {
      f = task === undefined ? await deps.client.file(path) : await deps.client.file(path, task);
    } catch (e) {
      const p = failed("file", e);
      return htmlPage(res, p.status, "file unavailable", html`<h1>file unavailable</h1><p data-code="${p.code}">${p.message}</p>`);
    }
    const name = basename(f.path ?? path);
    if (typeof f.text === "string") return htmlPage(res, 200, name, html`<h1>${name}</h1><pre>${f.text}</pre>`);
    if (typeof f.base64 === "string") {
      const safe = name.replace(/[^A-Za-z0-9._-]/g, "_") || "file";
      return send(res, 200, "application/octet-stream", Buffer.from(f.base64, "base64"), { "content-disposition": `attachment; filename="${safe}"` });
    }
    htmlPage(res, 502, "file unavailable", html`<h1>file unavailable</h1><p>weave sent no content for ${name}.</p>`);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [k, v] of Object.entries(securityHeaders())) res.setHeader(k, v);

    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://weave-ui");
    } catch {
      return htmlPage(res, 400, "bad request", html`<h1>bad request</h1>`);
    }
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (path === "/health") {
      return send(res, 200, "application/json", JSON.stringify({ ok: true, weave: deps.weaveUrl, insecureUpstream: deps.insecureUpstream }));
    }

    const admitted = requestTrusted(
      { remoteAddress: req.socket?.remoteAddress, host: req.headers.host, secFetchSite: headerString(req.headers["sec-fetch-site"]) },
      deps.trustCidrs,
    );
    // htmx swaps what /ui/ answers into the page, so its refusals are the error fragment.
    const fragmentRoute = path.startsWith("/ui/") && !path.startsWith("/ui/assets/");
    if (!admitted) {
      if (fragmentRoute) {
        return refuse(res, 403, "untrusted", "this address is not trusted; weave-ui admits loopback and the networks named with --trust-cidr <cidr> (or WEAVE_UI_TRUST_CIDR)");
      }
      return htmlPage(
        res,
        403,
        "not trusted",
        html`<h1>not trusted</h1><p>This address is not trusted. weave-ui admits loopback and the networks named with <code>--trust-cidr &lt;cidr&gt;</code> (or <code>WEAVE_UI_TRUST_CIDR</code>).</p>`,
      );
    }

    const pageName = PAGES[path];
    if (pageName !== undefined) {
      if (method !== "GET") return htmlPage(res, 405, "method not allowed", html`<h1>method not allowed</h1>`);
      return servePage(req, res, pageName);
    }
    if (path === "/peers") {
      if (method !== "GET") return htmlPage(res, 405, "method not allowed", html`<h1>method not allowed</h1>`);
      res.statusCode = 301;
      res.setHeader("location", `/machines${url.search}`);
      res.end();
      return;
    }

    if (path.startsWith("/ui/f/") || (req.url ?? "").startsWith("/ui/f/")) {
      if (method !== "GET") return refuse(res, 405, "method-not-allowed", "a view is read with GET");
      const name = path.slice("/ui/f/".length);
      if (!FRAGMENTS.has(name)) return refuse(res, 404, "unknown-view", "no such view");
      const r = await renderView(name, Object.fromEntries(url.searchParams));
      return send(res, r.status, HTML_TYPE, r.body);
    }

    if (path.startsWith("/ui/a/")) {
      if (method !== "POST") return refuse(res, 405, "method-not-allowed", "an action is sent with POST");
      return action(req, res, path.slice("/ui/a/".length));
    }

    if (path.startsWith("/ui/assets/")) {
      if (method !== "GET") return htmlPage(res, 405, "method not allowed", html`<h1>method not allowed</h1>`);
      return asset(res, path.slice("/ui/assets/".length));
    }

    if (path === "/events" && method === "GET") {
      deps.hub.attach(res);
      return;
    }

    if (path === "/file" && method === "GET") return file(res, url);

    if (fragmentRoute) return refuse(res, 404, "unknown-view", "no such view");

    htmlPage(res, 404, "not found", html`<h1>not found</h1>`);
  };

  return (req, res) => {
    handle(req, res).catch((e: unknown) => {
      log(`weave-ui: request failed: ${e instanceof Error ? e.message : String(e)}`);
      try {
        if (res.headersSent) res.end();
        else htmlPage(res, 500, "internal error", html`<h1>internal error</h1>`);
      } catch {
        // nothing more to do
      }
    });
  };
}
