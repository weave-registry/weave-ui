/** #8 — the browser-side protections that move from weave to weave-ui: the CSP and its sibling headers, and CSRF. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { securityHeaders, csrfToken, checkCsrf } from "../../src/server/security.js";

test("the CSP is the one weave served: self-only scripts and styles, no inline, no eval, no framing", () => {
  const h = securityHeaders();
  const csp = h["content-security-policy"]!;
  assert.ok(csp, "content-security-policy is set");
  assert.match(csp, /(^|; )default-src 'none'(;|$)/);
  assert.match(csp, /(^|; )script-src 'self'(;|$)/);
  assert.match(csp, /(^|; )style-src 'self'(;|$)/);
  assert.match(csp, /(^|; )connect-src 'self'(;|$)/);
  assert.match(csp, /(^|; )form-action 'self'(;|$)/);
  assert.match(csp, /(^|; )frame-ancestors 'none'(;|$)/);
  assert.match(csp, /(^|; )base-uri 'none'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*|https?:/);
});

test("sibling headers: nosniff, no referrer, no framing, never cached (a console page is the operator's)", () => {
  const h = securityHeaders();
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["referrer-policy"], "no-referrer");
  assert.equal(h["x-frame-options"], "DENY");
  assert.match(h["cache-control"]!, /no-store/);
});

test("securityHeaders returns a fresh object each time (a caller may add to it)", () => {
  const a = securityHeaders();
  a["x-extra"] = "1";
  assert.equal(securityHeaders()["x-extra"], undefined);
});

test("a csrf token is deterministic per (key, session), differs across either, and is url-safe", () => {
  const t = csrfToken("key-1", "session-a");
  assert.equal(t, csrfToken("key-1", "session-a"));
  assert.notEqual(t, csrfToken("key-2", "session-a"));
  assert.notEqual(t, csrfToken("key-1", "session-b"));
  assert.match(t, /^[A-Za-z0-9_-]{32,}$/);
});

const KEY = "k";
const SID = "sid";
const good = () => csrfToken(KEY, SID);

test("safe methods need no token", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.deepEqual(checkCsrf({ method, headers: { host: "ui.lan:8789" }, key: KEY, sessionId: SID }), { ok: true });
  }
});

test("a state-changing request needs the token in x-csrf-token", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const ok = checkCsrf({ method, headers: { host: "ui.lan:8789", "x-csrf-token": good() }, key: KEY, sessionId: SID });
    assert.deepEqual(ok, { ok: true }, method);
    const missing = checkCsrf({ method, headers: { host: "ui.lan:8789" }, key: KEY, sessionId: SID });
    assert.equal(missing.ok, false);
    const wrong = checkCsrf({ method, headers: { host: "ui.lan:8789", "x-csrf-token": good().slice(1) + "x" }, key: KEY, sessionId: SID });
    assert.equal(wrong.ok, false);
    const otherSession = checkCsrf({ method, headers: { host: "ui.lan:8789", "x-csrf-token": csrfToken(KEY, "other") }, key: KEY, sessionId: SID });
    assert.equal(otherSession.ok, false);
  }
});

test("method case does not dodge the check", () => {
  assert.equal(checkCsrf({ method: "post", headers: { host: "h" }, key: KEY, sessionId: SID }).ok, false);
});

test("an Origin that is not this host is refused even with a valid token; a matching or absent one passes", () => {
  const base = { host: "ui.lan:8789", "x-csrf-token": good() };
  assert.equal(checkCsrf({ method: "POST", headers: { ...base, origin: "http://evil.example" }, key: KEY, sessionId: SID }).ok, false);
  assert.equal(checkCsrf({ method: "POST", headers: { ...base, origin: "http://ui.lan:8791" }, key: KEY, sessionId: SID }).ok, false);
  assert.equal(checkCsrf({ method: "POST", headers: { ...base, origin: "null" }, key: KEY, sessionId: SID }).ok, false);
  assert.equal(checkCsrf({ method: "POST", headers: { ...base, origin: "http://ui.lan:8789" }, key: KEY, sessionId: SID }).ok, true);
  assert.equal(checkCsrf({ method: "POST", headers: { ...base, origin: "https://ui.lan:8789" }, key: KEY, sessionId: SID }).ok, true);
  assert.equal(checkCsrf({ method: "POST", headers: base, key: KEY, sessionId: SID }).ok, true);
});

test("a cross-site fetch (sec-fetch-site) is refused", () => {
  const base = { host: "ui.lan:8789", "x-csrf-token": good() };
  assert.equal(checkCsrf({ method: "POST", headers: { ...base, "sec-fetch-site": "cross-site" }, key: KEY, sessionId: SID }).ok, false);
  assert.equal(checkCsrf({ method: "POST", headers: { ...base, "sec-fetch-site": "same-origin" }, key: KEY, sessionId: SID }).ok, true);
});

test("a refusal names its reason and never echoes the token", () => {
  const r = checkCsrf({ method: "POST", headers: { host: "h", "x-csrf-token": "attacker-token" }, key: KEY, sessionId: SID });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /csrf/i);
    assert.doesNotMatch(r.reason, /attacker-token/);
  }
});
