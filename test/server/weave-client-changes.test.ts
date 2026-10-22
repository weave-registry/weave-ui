/** #8 / weave ADR-0245 §4 — the upstream half of live updates: the weave client opens GET /api/v1/changes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createWeaveClient, UpstreamError } from "../../src/server/weave-client.js";
import { startStubWeave, type StubWeave } from "./stub-weave.js";

const SECRET = "console-secret-0123456789abcdefghijklmnop";

const waitFor = async (cond: () => boolean, what: string, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Serve /api/v1/changes from the stub; `streams` holds each open upstream response so a test can write frames. */
const changesUpstream = (s: StubWeave, opts: { refuseResume?: boolean } = {}): { streams: ServerResponse[]; requests: IncomingMessage[] } => {
  const streams: ServerResponse[] = [];
  const requests: IncomingMessage[] = [];
  s.use((req, _body, res) => {
    if (!(req.url ?? "").startsWith("/api/v1/changes")) return false;
    requests.push(req);
    if (req.headers["x-weave-secret"] !== SECRET) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no", code: "unauthorized", resolution: { code: "unauthorized", commands: [] } }));
      return true;
    }
    if (opts.refuseResume && req.headers["last-event-id"] !== undefined) {
      res.writeHead(410, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "cannot resume", code: "resume-refused", resolution: { code: "resume-refused", commands: [] } }));
      return true;
    }
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.write("retry: 3000\n\n");
    streams.push(res);
    return true;
  });
  return { streams, requests };
};

test("client.changes() opens /api/v1/changes with the credential, Accept text/event-stream and Last-Event-ID when resuming", async () => {
  const s = await startStubWeave({ secret: SECRET });
  const up = changesUpstream(s);
  try {
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    const first = await c.changes();
    assert.equal(up.requests[0]?.headers["x-weave-secret"], SECRET);
    assert.match(String(up.requests[0]?.headers.accept), /text\/event-stream/);
    assert.equal(up.requests[0]?.headers["last-event-id"], undefined);
    let got = "";
    first.setEncoding("utf8");
    first.on("data", (d: string) => (got += d));
    up.streams[0]!.write("id: 4\nevent: home\ndata: home\n\n");
    await waitFor(() => got.includes("event: home"), "the frame on the client stream");
    first.destroy();
    const second = await c.changes("4");
    assert.equal(up.requests[1]?.headers["last-event-id"], "4");
    second.destroy();
  } finally {
    await s.close();
  }
});

test("client.changes() rejects a refused stream as an UpstreamError with its status", async () => {
  const s = await startStubWeave({ secret: SECRET });
  changesUpstream(s, { refuseResume: true });
  try {
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    await assert.rejects(c.changes("9"), (e: unknown) => e instanceof UpstreamError && e.status === 410 && e.code === "resume-refused");
  } finally {
    await s.close();
  }
});

test("client.changes() takes an AbortSignal: aborting a pending subscription rejects it promptly and tears the request down", async () => {
  const c = createWeaveClient({ weaveUrl: "http://10.255.255.1:9", secret: SECRET, insecureUpstream: true, timeoutMs: 60_000 });
  const ac = new AbortController();
  const started = Date.now();
  const p = c.changes(undefined, ac.signal);
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(p, (e: unknown) => e instanceof UpstreamError);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  await assert.rejects(c.changes(undefined, AbortSignal.abort()), (e: unknown) => e instanceof UpstreamError, "an already-aborted signal makes no request");
});
