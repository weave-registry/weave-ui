/**
 * weave-ui's upstream client for weave's console API (weave ADR-0245 §2–§3, §6).
 *
 * The console credential travels only as the `X-Weave-Secret` header — never in a URL, a cookie, `Authorization` or
 * an `Origin`. Over TLS it is sent only on a connection pinned to a certificate that `/health`'s `x-weave-cert-hmac`
 * vouched for (ADR-0064 channel binding): the HMAC is checked over the certificate actually observed, and when the
 * certificate changes the pin is dropped and re-verified once before anything credentialed is retried. Plain HTTP is
 * accepted only on loopback unless `insecureUpstream` is set.
 *
 * node: built-ins only — `fetch` cannot expose the peer certificate.
 */
import { request as httpRequest, type IncomingMessage, type ClientRequest, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PeerCertificate, TLSSocket } from "node:tls";
import type { BarView, FileView, ReadEnvelope, Resolution } from "../../contract/console-views-v1.js";

export class UpstreamError extends Error {
  readonly code: string;
  /** The HTTP status weave answered with; 0 when there was none. */
  readonly status: number;
  readonly resolution?: Resolution;

  constructor(message: string, code: string, status = 0, resolution?: Resolution) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.status = status;
    if (resolution !== undefined) this.resolution = resolution;
  }
}

export interface WeaveClientOptions {
  readonly weaveUrl: string;
  readonly secret: string;
  readonly insecureUpstream?: boolean;
  readonly timeoutMs?: number;
  /** How long an open /api/v1/changes stream may sit idle before it is torn down (default 60000). */
  readonly streamIdleMs?: number;
}

export interface WeaveClient {
  /** TLS only: read /health without the credential and check its HMAC over the observed certificate. */
  verify(): Promise<void>;
  view<V = Readonly<Record<string, unknown>>>(name: string, query?: Readonly<Record<string, string>>): Promise<ReadEnvelope<V>>;
  bar(): Promise<BarView>;
  file(path: string, task?: string): Promise<FileView>;
  api(): Promise<{ version: string; refresh: Readonly<Record<string, readonly string[]>> }>;
  action(verb: string, body: unknown, opts?: { onBehalfOf?: string }): Promise<unknown>;
  /** Open GET /api/v1/changes as a live SSE stream (ADR-0245 §4); resolves with the still-readable response on 2xx. */
  changes(lastEventId?: string): Promise<IncomingMessage>;
}

const VERB = /^[A-Za-z][A-Za-z0-9]*$/;

const isLoopback = (hostname: string): boolean => {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
};

const sha256 = (b: Buffer): Buffer => createHash("sha256").update(b).digest();

const derToPem = (der: Buffer): string => {
  const b64 = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${b64.join("\n")}\n-----END CERTIFICATE-----\n`;
};

interface Pin {
  readonly pem: string;
  readonly fingerprint: Buffer;
}

interface Raw {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
  /** The DER of the peer certificate, over TLS. */
  readonly peerDer?: Buffer;
  /** The live, unread response — only for a stream request answered 2xx. */
  readonly res?: IncomingMessage;
}

/** A failure of the pinned TLS handshake — the certificate is not the one that was vouched for. */
class PinFailure extends Error {
  constructor(readonly cause: unknown) {
    super("pinned certificate rejected");
  }
}

export function createWeaveClient(opts: WeaveClientOptions): WeaveClient {
  const base = new URL(opts.weaveUrl);
  const tls = base.protocol === "https:";
  if (!tls && base.protocol !== "http:") {
    throw new UpstreamError(`weave URL must be http: or https:, got ${base.protocol}`, "insecure-upstream");
  }
  if (!tls && !isLoopback(base.hostname) && opts.insecureUpstream !== true) {
    throw new UpstreamError(
      `refusing plain http to non-loopback weave at ${base.origin}; use https or set insecureUpstream`,
      "insecure-upstream",
    );
  }
  const secret = opts.secret;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const streamIdleMs = opts.streamIdleMs ?? 60_000;
  const origin = base.origin;
  let pin: Pin | undefined;
  let verifying: Promise<void> | undefined;

  const unreachable = (e: unknown): UpstreamError => {
    const code = (e as { code?: unknown } | null)?.code;
    const why = typeof code === "string" ? code : e instanceof Error ? e.message : String(e);
    return new UpstreamError(`weave at ${origin} is unreachable: ${why.split(secret).join("<redacted>")}`, "upstream-unreachable");
  };

  const send = (method: string, path: string, headers: OutgoingHttpHeaders, body: string | undefined, pinned: Pin | undefined, stream = false): Promise<Raw> =>
    new Promise<Raw>((resolve, reject) => {
      const target = new URL(path, base);
      let tcpUp = false;
      let tlsUp = false;
      let pinMismatch = false;
      let live: IncomingMessage | undefined;
      const common = {
        method,
        protocol: target.protocol,
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: body !== undefined ? { ...headers, "content-length": Buffer.byteLength(body) } : headers,
        agent: false as const,
      };
      let req: ClientRequest;
      if (tls) {
        const tlsOpts: HttpsRequestOptions = pinned
          ? {
              ...common,
              ca: pinned.pem,
              rejectUnauthorized: true,
              checkServerIdentity: (_host: string, cert: PeerCertificate): Error | undefined => {
                if (cert.raw && sha256(cert.raw).equals(pinned.fingerprint)) return undefined;
                pinMismatch = true;
                return new Error("certificate does not match the verified pin");
              },
            }
          : { ...common, rejectUnauthorized: false };
        req = httpsRequest(tlsOpts);
      } else {
        req = httpRequest(common);
      }
      req.on("socket", (sock) => {
        sock.once("connect", () => (tcpUp = true));
        sock.once("secureConnect", () => (tlsUp = true));
      });
      req.setTimeout(timeoutMs, () => {
        const e = new Error("ETIMEDOUT") as Error & { code: string };
        e.code = "ETIMEDOUT";
        if (live) live.destroy(e);
        else req.destroy(e);
      });
      req.on("error", (e) => {
        if (tls && pinned && (pinMismatch || (tcpUp && !tlsUp))) reject(new PinFailure(e));
        else reject(unreachable(e));
      });
      req.on("response", (res) => {
        let peerDer: Buffer | undefined;
        if (tls) {
          const raw = (res.socket as TLSSocket).getPeerCertificate?.()?.raw;
          if (raw && raw.length > 0) peerDer = raw;
        }
        const status = res.statusCode ?? 0;
        if (stream && status >= 200 && status < 300) {
          live = res;
          req.setTimeout(streamIdleMs);
          resolve({ status, headers: res.headers, body: "", res, ...(peerDer !== undefined ? { peerDer } : {}) });
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", (e) => reject(unreachable(e)));
        res.on("end", () =>
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            ...(peerDer !== undefined ? { peerDer } : {}),
          }),
        );
      });
      req.end(body);
    });

  const verify = (): Promise<void> => {
    if (!tls) return Promise.resolve();
    if (verifying) return verifying;
    verifying = (async () => {
      const r = await send("GET", "/health", { accept: "application/json" }, undefined, undefined);
      const given = r.headers["x-weave-cert-hmac"];
      if (r.peerDer === undefined) throw new UpstreamError(`weave at ${origin} presented no certificate`, "channel-binding");
      const fingerprint = sha256(r.peerDer);
      const expected = Buffer.from(createHmac("sha256", secret).update(fingerprint).digest("hex"), "utf8");
      const got = Buffer.from(typeof given === "string" ? given : "", "utf8");
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
        throw new UpstreamError(
          `weave at ${origin} did not vouch for the certificate it presented (x-weave-cert-hmac ${typeof given === "string" ? "mismatch" : "missing"})`,
          "channel-binding",
        );
      }
      pin = { pem: derToPem(r.peerDer), fingerprint };
    })().finally(() => {
      verifying = undefined;
    });
    return verifying;
  };

  const credentialed = async (method: string, path: string, extra: OutgoingHttpHeaders, body?: string, stream = false): Promise<Raw> => {
    const headers: OutgoingHttpHeaders = { accept: "application/json", ...extra, "x-weave-secret": secret };
    if (!tls) return send(method, path, headers, body, undefined, stream);
    if (!pin) await verify();
    try {
      return await send(method, path, headers, body, pin, stream);
    } catch (e) {
      if (!(e instanceof PinFailure)) throw e;
      pin = undefined;
      await verify();
      try {
        return await send(method, path, headers, body, pin, stream);
      } catch (e2) {
        if (e2 instanceof PinFailure) {
          pin = undefined;
          throw new UpstreamError(`weave at ${origin} changed its certificate again during verification`, "channel-binding");
        }
        throw e2;
      }
    }
  };

  const parse = (r: Raw): unknown => {
    let doc: unknown;
    try {
      doc = JSON.parse(r.body);
    } catch {
      doc = undefined;
    }
    if (r.status >= 200 && r.status < 300) {
      if (doc === undefined) throw new UpstreamError(`weave at ${origin} answered with unparseable JSON`, "upstream-error", r.status);
      return doc;
    }
    const d = doc as { ok?: unknown; error?: unknown; code?: unknown; resolution?: unknown } | undefined;
    if (d && typeof d === "object" && d.ok === false && typeof d.error === "string" && typeof d.code === "string") {
      const resolution = d.resolution && typeof d.resolution === "object" ? (d.resolution as Resolution) : undefined;
      throw new UpstreamError(d.error, r.status === 401 ? "credential-refused" : d.code, r.status, resolution);
    }
    throw new UpstreamError(
      `weave at ${origin} answered ${r.status}`,
      r.status === 401 ? "credential-refused" : "upstream-error",
      r.status,
    );
  };

  const view = async <V = Readonly<Record<string, unknown>>>(name: string, query?: Readonly<Record<string, string>>): Promise<ReadEnvelope<V>> => {
    const qs = query ? new URLSearchParams(query).toString() : "";
    const r = await credentialed("GET", `/api/v1/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`, {});
    return parse(r) as ReadEnvelope<V>;
  };

  return {
    verify,
    view,
    bar: async () => (await view<BarView>("bar")).view,
    file: async (path, task) => (await view<FileView>("file", { path, ...(task !== undefined ? { task } : {}) })).view,
    api: async () => {
      const doc = parse(await credentialed("GET", "/api/v1", {})) as {
        info?: { version?: unknown };
        paths?: Record<string, { post?: { "x-refresh"?: unknown } } | undefined>;
      };
      const refresh: Record<string, readonly string[]> = {};
      for (const [p, item] of Object.entries(doc.paths ?? {})) {
        const m = /^\/api\/v1\/actions\/([^/]+)$/.exec(p);
        const list = item?.post?.["x-refresh"];
        if (m?.[1] && Array.isArray(list) && list.every((x): x is string => typeof x === "string")) refresh[m[1]] = list;
      }
      return { version: String(doc.info?.version ?? ""), refresh };
    },
    action: async (verb, body, o) => {
      if (!VERB.test(verb)) throw new UpstreamError(`not an action verb: ${JSON.stringify(verb)}`, "bad-verb");
      const headers: OutgoingHttpHeaders = {
        "content-type": "application/json",
        ...(o?.onBehalfOf !== undefined ? { "x-weave-on-behalf-of": o.onBehalfOf } : {}),
      };
      return parse(await credentialed("POST", `/api/v1/actions/${verb}`, headers, JSON.stringify(body)));
    },
    changes: async (lastEventId) => {
      const headers: OutgoingHttpHeaders = {
        accept: "text/event-stream",
        ...(lastEventId !== undefined ? { "last-event-id": lastEventId } : {}),
      };
      const r = await credentialed("GET", "/api/v1/changes", headers, undefined, true);
      if (r.res) return r.res;
      parse(r);
      throw new UpstreamError(`weave at ${origin} answered ${r.status} without a stream`, "upstream-error", r.status);
    },
  };
}
