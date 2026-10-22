/**
 * #8 / weave ADR-0245 §5 — address trust moves with the browser: a request is admitted without a session when its
 * SOCKET address is loopback or inside a `--trust-cidr`, its Host is one a public attacker cannot point here (ADR-0220
 * §4, DNS rebinding), and Sec-Fetch-Site does not say another site asked (§5). weave-ui's own copy of the pure rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCidr, hostTrustable, fetchSiteTrustable, requestTrusted } from "../../src/server/trust.js";

const LAN = [parseCidr("192.168.1.0/24")];

test("loopback is always trusted, with no --trust-cidr at all (v4, v6 and v4-mapped)", () => {
  for (const addr of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(requestTrusted({ remoteAddress: addr, host: "localhost:8790" }, []), true, addr);
  }
});

test("a --trust-cidr network is trusted; any other address is not", () => {
  assert.equal(requestTrusted({ remoteAddress: "192.168.1.40", host: "bazzite.lan:8790" }, LAN), true);
  assert.equal(requestTrusted({ remoteAddress: "192.168.2.40", host: "bazzite.lan:8790" }, LAN), false);
  assert.equal(requestTrusted({ remoteAddress: "203.0.113.9", host: "bazzite.lan:8790" }, LAN), false);
  assert.equal(requestTrusted({ remoteAddress: undefined, host: "localhost" }, LAN), false, "no socket address is never trusted");
  assert.equal(requestTrusted({ remoteAddress: "not-an-ip", host: "localhost" }, LAN), false);
});

test("the Host must be one no stranger can point here: an IP literal, localhost, one label, or a private-use suffix", () => {
  for (const h of ["127.0.0.1:8790", "[::1]:8790", "localhost", "localhost:8790", "bazzite", "bazzite:8790", "bazzite.local", "box.lan:1", "box.home", "box.home.arpa", "box.internal", "box.localdomain", "x.localhost", "box.tail1234.ts.net", "192.168.1.5", "BAZZITE.LAN."]) {
    assert.equal(hostTrustable(h), true, h);
  }
  for (const h of [undefined, "", "evil.example.com", "evil.example.com:8790", "lan.example.com", "weave.local.example.org", "[zz::1]"]) {
    assert.equal(hostTrustable(h), false, String(h));
  }
});

test("a DNS-rebinding Host is refused even from loopback", () => {
  assert.equal(requestTrusted({ remoteAddress: "127.0.0.1", host: "evil.example.com:8790" }, []), false);
});

test("Sec-Fetch-Site: absent, same-origin or none pass; same-site and cross-site do not", () => {
  assert.equal(fetchSiteTrustable(undefined), true);
  assert.equal(fetchSiteTrustable("same-origin"), true);
  assert.equal(fetchSiteTrustable("none"), true);
  assert.equal(fetchSiteTrustable("same-site"), false);
  assert.equal(fetchSiteTrustable("cross-site"), false);
  assert.equal(requestTrusted({ remoteAddress: "127.0.0.1", host: "localhost", secFetchSite: "cross-site" }, []), false);
});
