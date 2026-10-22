/**
 * A stub weave for the server tests (weave ADR-0245 §2–§4): it answers /health, /api/v1, views and actions the way
 * weave's console port does, over plain HTTP or over TLS with a throwaway self-signed certificate, and records every
 * request with the certificate the connection carried — so a test can prove the console credential was only ever sent
 * on a connection whose certificate weave had vouched for.
 *
 * Certificates are generated per run with `openssl` into a temporary directory; nothing key-shaped is committed.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createHash, createHmac, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";

export interface TestCert {
  readonly key: string;
  readonly cert: string;
  /** sha256 over the DER bytes — what a client observes. */
  readonly fingerprint: Buffer;
}

/** A fresh self-signed certificate for CN=localhost (IP SAN 127.0.0.1). `weaveLike` makes it the shape weave's
 *  `self-signed-tls.ts` issues: basicConstraints CA:false and a SAN that does not name the address dialled. */
export function makeCert(opts: { weaveLike?: boolean } = {}): TestCert {
  const dir = mkdtempSync(join(tmpdir(), "wui-cert-"));
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
      "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "2",
      ...(opts.weaveLike
        ? ["-subj", "/CN=weave-host", "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "subjectAltName=DNS:weave-host"]
        : ["-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]),
    ], { stdio: "ignore" });
    const cert = readFileSync(join(dir, "c.pem"), "utf8");
    const key = readFileSync(join(dir, "k.pem"), "utf8");
    return { key, cert, fingerprint: createHash("sha256").update(new X509Certificate(cert).raw).digest() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** weave's `x-weave-cert-hmac`: hex HMAC-SHA256(secret, sha256(cert DER)) — weave src/domain/channel-binding.ts. */
export function certHmac(secret: string, fingerprint: Buffer): string {
  return createHmac("sha256", secret).update(fingerprint).digest("hex");
}

export interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
  /** sha256 hex of the certificate this connection presented; "" over plain HTTP. */
  readonly certFp: string;
}

export type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => boolean | void;

export interface StubWeave {
  readonly url: string;
  readonly seen: SeenRequest[];
  /** Answer GET /api/v1/<name> with this view (wrapped in the read envelope). */
  setView(name: string, view: unknown): void;
  /** Answer a path with a refusal {ok:false, error, code, resolution} at `status`. */
  refuse(path: string, status: number, code: string, error: string): void;
  /** Swap the certificate for new connections (and drop idle ones); `hmacFor` picks the cert /health vouches for. */
  rotate(cert: TestCert, hmacFor?: TestCert): void;
  /** Make /health vouch with this HMAC value instead of the right one. */
  setHealthHmac(value: string | undefined): void;
  /** A handler tried before the defaults; return true when it answered. */
  use(h: Handler): void;
  close(): Promise<void>;
}

export const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "weave console API", version: "1.2" },
  paths: {
    "/api/v1/home": { get: { operationId: "view_home" } },
    "/api/v1/actions/grant": { post: { operationId: "action_grant", "x-refresh": ["home"] } },
    "/api/v1/actions/yolo": { post: { operationId: "action_yolo", "x-refresh": ["home", "control"] } },
    "/api/v1/actions/cancel": { post: { operationId: "action_cancel", "x-refresh": ["home", "work"] } },
  },
};

export async function startStubWeave(opts: { secret: string; tls?: TestCert } = { secret: "s" }): Promise<StubWeave> {
  const seen: SeenRequest[] = [];
  const views = new Map<string, unknown>();
  const refusals = new Map<string, { status: number; code: string; error: string }>();
  const handlers: Handler[] = [];
  let current = opts.tls;
  let vouchFor = opts.tls;
  let healthOverride: string | undefined | null = null;

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => (body += c));
    req.on("end", () => {
      const sock = req.socket as TLSSocket;
      const raw = typeof sock.getCertificate === "function" ? (sock.getCertificate() as { raw?: Buffer } | null)?.raw : undefined;
      const certFp = raw ? createHash("sha256").update(raw).digest("hex") : "";
      seen.push({ method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body, certFp });
      for (const h of handlers) if (h(req, body, res) === true) return;
      const url = new URL(req.url ?? "/", "http://stub");
      const path = url.pathname;
      const json = (status: number, v: unknown, extra: Record<string, string> = {}): void => {
        res.writeHead(status, { "content-type": "application/json", ...extra });
        res.end(JSON.stringify(v));
      };
      if (path === "/health") {
        const extra: Record<string, string> = {};
        const value = healthOverride !== null ? healthOverride : vouchFor ? certHmac(opts.secret, vouchFor.fingerprint) : undefined;
        if (value !== undefined) extra["x-weave-cert-hmac"] = value;
        return json(200, { ok: true }, extra);
      }
      const r = refusals.get(path);
      if (r) return json(r.status, { ok: false, error: r.error, code: r.code, resolution: { code: r.code, commands: [] } });
      const given = req.headers["x-weave-secret"];
      if (given !== opts.secret) {
        return json(401, { ok: false, error: "no credential", code: "unauthorized", resolution: { code: "unauthorized", commands: [] } });
      }
      if (path === "/api/v1") return json(200, OPENAPI);
      if (path.startsWith("/api/v1/actions/") && req.method === "POST") {
        return json(200, { ok: true, verb: path.slice("/api/v1/actions/".length), refresh: ["home"] });
      }
      if (path.startsWith("/api/v1/") && req.method === "GET") {
        const name = path.slice("/api/v1/".length);
        if (!views.has(name)) {
          return json(404, { ok: false, error: `no view '${name}'`, code: "unknown-view", resolution: { code: "unknown-view", commands: [] } });
        }
        return json(200, { ok: true, api: "1.2", view: views.get(name), count: 1, note: "" });
      }
      json(404, { ok: false, error: "not found", code: "unknown-view", resolution: { code: "unknown-view", commands: [] } });
    });
  };

  const server: Server = opts.tls ? createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, listener) : createHttpServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `${opts.tls ? "https" : "http"}://127.0.0.1:${port}`,
    seen,
    setView: (name, view) => void views.set(name, view),
    refuse: (path, status, code, error) => void refusals.set(path, { status, code, error }),
    rotate: (cert, hmacFor = cert) => {
      current = cert;
      vouchFor = hmacFor;
      (server as unknown as { setSecureContext(o: { key: string; cert: string }): void }).setSecureContext({ key: current.key, cert: current.cert });
      server.closeAllConnections();
    },
    setHealthHmac: (value) => void (healthOverride = value),
    use: (h) => void handlers.push(h),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const hex = (b: Buffer): string => b.toString("hex");
