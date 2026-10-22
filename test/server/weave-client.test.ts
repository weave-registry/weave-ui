/**
 * #8 / weave ADR-0245 §2–§3, §6 — the upstream weave client: the console credential travels as a header only, over
 * weave's TLS only after `/health`'s `x-weave-cert-hmac` has vouched for the certificate actually observed (ADR-0064
 * channel binding), re-verified when the certificate changes; plain HTTP only on loopback unless insecureUpstream.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWeaveClient, UpstreamError } from "../../src/server/weave-client.js";
import { startStubWeave, makeCert, certHmac, hex, type StubWeave } from "./stub-weave.js";

const SECRET = "console-secret-0123456789abcdefghijklmnop";

const withStub = async (opts: Parameters<typeof startStubWeave>[0], fn: (s: StubWeave) => Promise<void>): Promise<void> => {
  const s = await startStubWeave(opts);
  try {
    await fn(s);
  } finally {
    await s.close();
  }
};

const rejectsWith = async (p: Promise<unknown>, code: string): Promise<UpstreamError> => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof UpstreamError, `an UpstreamError, got ${String(e)}`);
    assert.equal(e.code, code);
    assert.ok(!e.message.includes(SECRET), "an error never carries the secret");
    return e;
  }
  assert.fail(`expected a rejection with code ${code}`);
};

test("over loopback HTTP a view is read with the credential as X-Weave-Secret — never in the URL, no cookie, no Origin", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    s.setView("home", { needsYou: [] });
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    const env = await c.view<{ needsYou: unknown[] }>("home");
    assert.equal(env.ok, true);
    assert.deepEqual(env.view, { needsYou: [] });
    const r = s.seen.find((q) => q.url.startsWith("/api/v1/home"))!;
    assert.equal(r.method, "GET");
    assert.equal(r.headers["x-weave-secret"], SECRET);
    assert.ok(!r.url.includes(SECRET), "the secret is never in the URL");
    assert.equal(r.headers.cookie, undefined);
    assert.equal(r.headers.origin, undefined);
    assert.equal(r.headers.authorization, undefined);
  });
});

test("view query parameters are passed URL-encoded (fields, limit, id)", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    s.setView("task", { id: "a b" });
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    await c.view("task", { id: "a b&c", fields: "id" });
    const r = s.seen.find((q) => q.url.startsWith("/api/v1/task"))!;
    const u = new URL(r.url, "http://x");
    assert.equal(u.searchParams.get("id"), "a b&c");
    assert.equal(u.searchParams.get("fields"), "id");
  });
});

test("plain http to a non-loopback weave is refused unless insecureUpstream is set; loopback names are fine", () => {
  for (const url of ["http://10.0.0.7:8787", "http://weave.lan:8787", "http://192.168.1.2"]) {
    assert.throws(() => createWeaveClient({ weaveUrl: url, secret: SECRET }), (e: unknown) => e instanceof UpstreamError && e.code === "insecure-upstream");
    assert.doesNotThrow(() => createWeaveClient({ weaveUrl: url, secret: SECRET, insecureUpstream: true }));
  }
  for (const url of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787", "http://127.0.0.2:1"]) {
    assert.doesNotThrow(() => createWeaveClient({ weaveUrl: url, secret: SECRET }));
  }
  assert.doesNotThrow(() => createWeaveClient({ weaveUrl: "https://weave.lan:8787", secret: SECRET }));
});

test("over TLS: /health is read first with no credential, its HMAC checked over the observed certificate, then the view", async () => {
  const cert = makeCert();
  await withStub({ secret: SECRET, tls: cert }, async (s) => {
    s.setView("home", { ok: 1 });
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    const env = await c.view("home");
    assert.deepEqual(env.view, { ok: 1 });
    assert.equal(s.seen[0]?.url, "/health");
    assert.equal(s.seen[0]?.headers["x-weave-secret"], undefined, "/health carries no credential");
    assert.equal(s.seen[0]?.headers.authorization, undefined);
    for (const r of s.seen.filter((q) => q.headers["x-weave-secret"] !== undefined)) {
      assert.equal(r.certFp, hex(cert.fingerprint), "the credential only on the vouched-for certificate");
    }
  });
});

test("over TLS: a /health HMAC that does not match the observed certificate (a man in the middle) stops the client before it sends the secret", async () => {
  const cert = makeCert();
  const other = makeCert();
  await withStub({ secret: SECRET, tls: cert }, async (s) => {
    s.setView("home", {});
    s.setHealthHmac(certHmac(SECRET, other.fingerprint));
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    await rejectsWith(c.view("home"), "channel-binding");
    assert.ok(s.seen.every((q) => q.headers["x-weave-secret"] === undefined), "no request carried the secret");
  });
});

test("over TLS: a missing HMAC, or one keyed by another secret, is a channel-binding failure too", async () => {
  const cert = makeCert();
  await withStub({ secret: SECRET, tls: cert }, async (s) => {
    s.setView("home", {});
    s.setHealthHmac(undefined);
    await rejectsWith(createWeaveClient({ weaveUrl: s.url, secret: SECRET }).view("home"), "channel-binding");
    s.setHealthHmac(certHmac("some-other-secret", cert.fingerprint));
    await rejectsWith(createWeaveClient({ weaveUrl: s.url, secret: SECRET }).view("home"), "channel-binding");
    assert.ok(s.seen.every((q) => q.headers["x-weave-secret"] === undefined));
  });
});

test("over TLS: a re-issued certificate that /health vouches for is re-verified and just works", async () => {
  const first = makeCert();
  const second = makeCert();
  await withStub({ secret: SECRET, tls: first }, async (s) => {
    s.setView("home", { n: 1 });
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    await c.view("home");
    s.rotate(second);
    const before = s.seen.length;
    const env = await c.view("home");
    assert.deepEqual(env.view, { n: 1 });
    const after = s.seen.slice(before);
    const firstSecret = after.findIndex((q) => q.headers["x-weave-secret"] !== undefined);
    const health = after.findIndex((q) => q.url === "/health" && q.certFp === hex(second.fingerprint));
    assert.ok(health >= 0 && health < firstSecret, "re-verified on the new certificate before the credential was sent");
    for (const r of after.filter((q) => q.headers["x-weave-secret"] !== undefined)) assert.equal(r.certFp, hex(second.fingerprint));
  });
});

test("over TLS: a changed certificate that /health does NOT vouch for gets no credential", async () => {
  const first = makeCert();
  const mitm = makeCert();
  await withStub({ secret: SECRET, tls: first }, async (s) => {
    s.setView("home", {});
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    await c.view("home");
    s.rotate(mitm, first); // the new certificate, but /health still vouches for the old one
    await rejectsWith(c.view("home"), "channel-binding");
    assert.ok(
      s.seen.filter((q) => q.certFp === hex(mitm.fingerprint)).every((q) => q.headers["x-weave-secret"] === undefined),
      "nothing on the unvouched certificate carried the secret",
    );
  });
});

test("over TLS: a certificate shaped like weave's own (CA:false, a SAN that does not name the address) is pinned and works", async () => {
  const cert = makeCert({ weaveLike: true });
  await withStub({ secret: SECRET, tls: cert }, async (s) => {
    s.setView("home", { w: 1 });
    const env = await createWeaveClient({ weaveUrl: s.url, secret: SECRET }).view("home");
    assert.deepEqual(env.view, { w: 1 });
  });
});

test("bar() reads /api/v1/bar and returns the view", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    const bar = { on: false, set: false, source: "default", grants: { factory: false, merge: false, fleet: false }, halt: { halted: false, drain: false }, needsYou: 2, decidedForYou: 1 };
    s.setView("bar", bar);
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    assert.deepEqual(await c.bar(), bar);
  });
});

test("file(path, task) reads /api/v1/file with path and task as query parameters", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    const f = { path: "/tmp/out put.md", size: 5, contentType: "text/markdown", text: "hello" };
    s.setView("file", f);
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    assert.deepEqual(await c.file("/tmp/out put.md", "t-1"), f);
    const u = new URL(s.seen.find((q) => q.url.startsWith("/api/v1/file"))!.url, "http://x");
    assert.equal(u.searchParams.get("path"), "/tmp/out put.md");
    assert.equal(u.searchParams.get("task"), "t-1");
    await c.file("/a");
    const u2 = new URL(s.seen.filter((q) => q.url.startsWith("/api/v1/file")).at(-1)!.url, "http://x");
    assert.equal(u2.searchParams.has("task"), false, "no task parameter when none is given");
  });
});

test("api() reads the OpenAPI document: info.version and each action's x-refresh list", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    const a = await c.api();
    assert.equal(a.version, "1.2");
    assert.deepEqual(a.refresh["grant"], ["home"]);
    assert.deepEqual(a.refresh["yolo"], ["home", "control"]);
    assert.deepEqual(a.refresh["cancel"], ["home", "work"]);
    assert.equal(a.refresh["home"], undefined, "views are not actions");
  });
});

test("action() POSTs JSON with the credential and X-Weave-On-Behalf-Of, and no Origin", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    const out = await c.action("grant", { approve: "r-1" }, { onBehalfOf: "gary" });
    assert.equal((out as { ok: boolean }).ok, true);
    const r = s.seen.find((q) => q.url === "/api/v1/actions/grant")!;
    assert.equal(r.method, "POST");
    assert.match(String(r.headers["content-type"]), /^application\/json/);
    assert.deepEqual(JSON.parse(r.body), { approve: "r-1" });
    assert.equal(r.headers["x-weave-secret"], SECRET);
    assert.equal(r.headers["x-weave-on-behalf-of"], "gary");
    assert.equal(r.headers.origin, undefined);
    await c.action("cancel", { id: "t" });
    const r2 = s.seen.find((q) => q.url === "/api/v1/actions/cancel")!;
    assert.equal(r2.headers["x-weave-on-behalf-of"], undefined);
  });
});

test("action() refuses a verb that is not a plain name, without a request", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    for (const bad of ["../health", "a/b", "", "x?y=1"]) await rejectsWith(c.action(bad, {}), "bad-verb");
    assert.equal(s.seen.length, 0);
  });
});

test("a weave refusal becomes an UpstreamError with the status, code and resolution", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    s.refuse("/api/v1/actions/fleet", 403, "console-scope", "POST /api/v1/actions/fleet is outside the console scope");
    const c = createWeaveClient({ weaveUrl: s.url, secret: SECRET });
    const e = await rejectsWith(c.action("fleet", { halt: true }), "console-scope");
    assert.equal(e.status, 403);
    assert.equal(e.resolution?.code, "console-scope");
    assert.match(e.message, /outside the console scope/);
  });
});

test("a refused credential (401) is code 'credential-refused'", async () => {
  await withStub({ secret: SECRET }, async (s) => {
    s.setView("home", {});
    const c = createWeaveClient({ weaveUrl: s.url, secret: "the-wrong-secret-entirely-000000000" });
    const e = await rejectsWith(c.view("home"), "credential-refused");
    assert.equal(e.status, 401);
  });
});

test("an unreachable weave is code 'upstream-unreachable', and the message names the URL but never the secret", async () => {
  const c = createWeaveClient({ weaveUrl: "http://127.0.0.1:1", secret: SECRET });
  const e = await rejectsWith(c.view("home"), "upstream-unreachable");
  assert.match(e.message, /127\.0\.0\.1:1/);
});

test("a weave that never answers the connection (a black-holed address) fails within timeoutMs, not the OS's connect timeout", async () => {
  const c = createWeaveClient({ weaveUrl: "http://10.255.255.1:9", secret: SECRET, insecureUpstream: true, timeoutMs: 300 });
  const started = Date.now();
  await rejectsWith(c.view("home"), "upstream-unreachable");
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});
