/**
 * #8 / weave ADR-0245 §4 — live updates go through weave-ui: ONE upstream subscription to weave's
 * `GET /api/v1/changes`, resumed with Last-Event-ID, fanned out to every browser on weave-ui's own SSE stream as bare
 * view names. A refused resume tells every browser to refresh everything once; a browser that stops reading is dropped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, get, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createWeaveClient } from "../../src/server/weave-client.js";
import { createChangesHub, RESYNC_EVENT, type SseSink } from "../../src/server/changes.js";
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

/** A browser: an HTTP server whose only route attaches the hub, and a reader that collects what arrives. */
const browserSide = async (attach: (res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = createServer((_req, res) => attach(res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
  return { url, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
};

const openBrowser = (url: string): Promise<{ text: () => string; headers: IncomingMessage["headers"]; close: () => void }> =>
  new Promise((resolve, reject) => {
    let buf = "";
    const req = get(url, (res) => {
      res.setEncoding("utf8");
      res.on("data", (c: string) => (buf += c));
      resolve({ text: () => buf, headers: res.headers, close: () => req.destroy() });
    });
    req.on("error", (e) => (buf === "" ? reject(e) : undefined));
  });

const fakeSink = (): SseSink & { chunks: string[]; destroyed: boolean; ended: boolean; head: { status: number; headers: Record<string, string> } | undefined; length: number; fireClose: () => void } => {
  const closers: (() => void)[] = [];
  const sink = {
    chunks: [] as string[],
    destroyed: false,
    ended: false,
    length: 0,
    head: undefined as { status: number; headers: Record<string, string> } | undefined,
    writeHead(status: number, headers: Record<string, string>) {
      sink.head = { status, headers };
      return sink;
    },
    write(chunk: string) {
      sink.chunks.push(chunk);
      return true;
    },
    get writableLength() {
      return sink.length;
    },
    end() {
      sink.ended = true;
    },
    destroy() {
      sink.destroyed = true;
    },
    on(_event: "close", fn: () => void) {
      closers.push(fn);
      return sink;
    },
    fireClose: () => closers.forEach((f) => f()),
  };
  return sink;
};

test("attach() answers as an SSE stream: event-stream, never cached, unbuffered by proxies, with a retry hint", () => {
  const hub = createChangesHub({ source: { changes: () => new Promise(() => {}) } });
  const sink = fakeSink();
  hub.attach(sink);
  assert.equal(sink.head?.status, 200);
  assert.match(sink.head?.headers["content-type"] ?? "", /^text\/event-stream/);
  assert.match(sink.head?.headers["cache-control"] ?? "", /no-cache/);
  assert.equal(sink.head?.headers["x-accel-buffering"], "no");
  assert.ok(sink.chunks.join("").includes("retry: "), "a retry hint");
  assert.equal(hub.clients, 1);
  sink.fireClose();
  assert.equal(hub.clients, 0, "a closed browser is forgotten");
  void hub.stop();
});

test("three browsers share ONE upstream subscription, and each gets every view name", async () => {
  const s = await startStubWeave({ secret: SECRET });
  const up = changesUpstream(s);
  const hub = createChangesHub({ source: createWeaveClient({ weaveUrl: s.url, secret: SECRET }) });
  const side = await browserSide((res) => hub.attach(res));
  try {
    hub.start();
    const browsers = await Promise.all([openBrowser(side.url), openBrowser(side.url), openBrowser(side.url)]);
    await waitFor(() => up.streams.length === 1 && hub.clients === 3, "one upstream, three browsers");
    up.streams[0]!.write("id: 7\nevent: home\ndata: home\n\nid: 7\nevent: task:t-1\ndata: task:t-1\n\n");
    for (const b of browsers) await waitFor(() => b.text().includes("event: task:t-1\ndata: task:t-1\n\n"), "both frames at every browser");
    for (const b of browsers) assert.ok(b.text().includes("event: home\ndata: home\n\n"));
    assert.match(String(browsers[0]!.headers["content-type"]), /^text\/event-stream/);
    assert.equal(up.requests.length, 1, "still one upstream request");
    assert.equal(hub.lastEventId, "7");
    browsers.forEach((b) => b.close());
  } finally {
    await hub.stop();
    await side.close();
    await s.close();
  }
});

test("a browser gets only the view name — never upstream data, ids, or a name that is not a plain view name", async () => {
  const s = await startStubWeave({ secret: SECRET });
  const up = changesUpstream(s);
  const hub = createChangesHub({ source: createWeaveClient({ weaveUrl: s.url, secret: SECRET }) });
  const sink = fakeSink();
  try {
    hub.start();
    hub.attach(sink);
    await waitFor(() => up.streams.length === 1, "the upstream");
    up.streams[0]!.write('id: 1\nevent: work\ndata: {"leak":"payload"}\n\n');
    up.streams[0]!.write("id: 2\nevent: <img src=x>\ndata: x\n\n");
    up.streams[0]!.write(":hb\n\n");
    up.streams[0]!.write("id: 3\nevent: audit\ndata: audit\n\n");
    await waitFor(() => sink.chunks.join("").includes("event: audit"), "the audit frame");
    const all = sink.chunks.join("");
    assert.ok(all.includes("event: work\ndata: work\n\n"));
    assert.ok(!all.includes("leak"), "no upstream data");
    assert.ok(!all.includes("<img"), "no unsafe name");
    assert.ok(!/^id:/m.test(all), "no upstream ids");
    assert.equal(hub.lastEventId, "3");
  } finally {
    await hub.stop();
    await s.close();
  }
});

test("on upstream loss the hub reconnects with Last-Event-ID, and browsers stay connected", async () => {
  const s = await startStubWeave({ secret: SECRET });
  const up = changesUpstream(s);
  const hub = createChangesHub({ source: createWeaveClient({ weaveUrl: s.url, secret: SECRET }), minBackoffMs: 10, maxBackoffMs: 50 });
  const sink = fakeSink();
  try {
    hub.start();
    hub.attach(sink);
    await waitFor(() => up.streams.length === 1, "the first upstream");
    up.streams[0]!.write("id: 12\nevent: home\ndata: home\n\n");
    await waitFor(() => hub.lastEventId === "12", "id 12");
    up.streams[0]!.end();
    await waitFor(() => up.streams.length === 2, "a reconnect");
    assert.equal(up.requests[1]?.headers["last-event-id"], "12");
    up.streams[1]!.write("id: 13\nevent: control\ndata: control\n\n");
    await waitFor(() => sink.chunks.join("").includes("event: control"), "a frame after the reconnect");
    assert.equal(sink.destroyed || sink.ended, false, "the browser stream survived");
    assert.equal(hub.clients, 1);
  } finally {
    await hub.stop();
    await s.close();
  }
});

test("a refused resume tells every browser to refresh everything once, then subscribes afresh from the head", async () => {
  const s = await startStubWeave({ secret: SECRET });
  const up = changesUpstream(s, { refuseResume: true });
  const hub = createChangesHub({ source: createWeaveClient({ weaveUrl: s.url, secret: SECRET }), minBackoffMs: 10, maxBackoffMs: 50 });
  const sink = fakeSink();
  try {
    hub.start();
    hub.attach(sink);
    await waitFor(() => up.streams.length === 1, "the first upstream");
    up.streams[0]!.write("id: 5\nevent: home\ndata: home\n\n");
    await waitFor(() => hub.lastEventId === "5", "id 5");
    up.streams[0]!.end();
    await waitFor(() => up.streams.length === 2, "a fresh subscription");
    const all = sink.chunks.join("");
    assert.equal(all.split(`event: ${RESYNC_EVENT}\n`).length - 1, 1, "exactly one refresh-everything event");
    assert.equal(up.requests.at(-1)?.headers["last-event-id"], undefined, "the fresh subscription does not resume");
  } finally {
    await hub.stop();
    await s.close();
  }
});

test("a browser that stops reading (its buffer past the cap) is dropped; the others keep getting frames", async () => {
  const s = await startStubWeave({ secret: SECRET });
  const up = changesUpstream(s);
  const hub = createChangesHub({ source: createWeaveClient({ weaveUrl: s.url, secret: SECRET }), maxClientBuffer: 1024 });
  const slow = fakeSink();
  const fast = fakeSink();
  try {
    hub.start();
    hub.attach(slow);
    hub.attach(fast);
    await waitFor(() => up.streams.length === 1, "the upstream");
    slow.length = 4096;
    up.streams[0]!.write("id: 1\nevent: home\ndata: home\n\n");
    await waitFor(() => slow.destroyed, "the slow browser dropped");
    assert.equal(hub.clients, 1);
    up.streams[0]!.write("id: 2\nevent: work\ndata: work\n\n");
    await waitFor(() => fast.chunks.join("").includes("event: work"), "the fast browser still served");
  } finally {
    await hub.stop();
    await s.close();
  }
});

test("browsers get heartbeat comments so idle proxies keep the stream open", async () => {
  const hub = createChangesHub({ source: { changes: () => new Promise(() => {}) }, heartbeatMs: 20 });
  const sink = fakeSink();
  try {
    hub.attach(sink);
    await waitFor(() => sink.chunks.some((c) => c.startsWith(":")), "a heartbeat comment");
  } finally {
    await hub.stop();
  }
});

test("stop() ends every browser stream and makes no further upstream request", async () => {
  const s = await startStubWeave({ secret: SECRET });
  const up = changesUpstream(s);
  const hub = createChangesHub({ source: createWeaveClient({ weaveUrl: s.url, secret: SECRET }), minBackoffMs: 10, maxBackoffMs: 20 });
  const sink = fakeSink();
  try {
    hub.start();
    hub.attach(sink);
    await waitFor(() => up.streams.length === 1, "the upstream");
    await hub.stop();
    assert.ok(sink.ended || sink.destroyed, "the browser stream was ended");
    assert.equal(hub.clients, 0);
    const n = up.requests.length;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(up.requests.length, n, "no reconnect after stop");
  } finally {
    await s.close();
  }
});
