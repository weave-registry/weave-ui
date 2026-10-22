/** #8 — the trusted-address rule (`--trust-cidr`): parse a CIDR, decide whether a peer address is inside one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCidr, isTrusted } from "../../src/server/trust.js";

test("parseCidr accepts IPv4 and IPv6 blocks and a bare address (a host route)", () => {
  assert.doesNotThrow(() => parseCidr("10.0.0.0/8"));
  assert.doesNotThrow(() => parseCidr("192.168.1.0/24"));
  assert.doesNotThrow(() => parseCidr("fd00::/8"));
  assert.doesNotThrow(() => parseCidr("127.0.0.1"));
  assert.doesNotThrow(() => parseCidr("::1"));
});

test("parseCidr refuses what is not a block", () => {
  for (const bad of ["", "10.0.0.0/33", "10.0.0/8", "10.0.0.256/8", "10.0.0.0/-1", "10.0.0.0/x", "fd00::/129", "not-an-address", "10.0.0.0/8/8", "1.2.3.4 /8"]) {
    assert.throws(() => parseCidr(bad), /cidr/i, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("isTrusted: inside and outside an IPv4 block", () => {
  const nets = [parseCidr("10.1.0.0/16")];
  assert.equal(isTrusted("10.1.2.3", nets), true);
  assert.equal(isTrusted("10.1.255.255", nets), true);
  assert.equal(isTrusted("10.2.0.1", nets), false);
  assert.equal(isTrusted("192.168.1.1", nets), false);
});

test("isTrusted: /0 trusts every address of its family only; /32 is one host", () => {
  assert.equal(isTrusted("8.8.8.8", [parseCidr("0.0.0.0/0")]), true);
  assert.equal(isTrusted("::1", [parseCidr("0.0.0.0/0")]), false);
  assert.equal(isTrusted("1.2.3.4", [parseCidr("1.2.3.4/32")]), true);
  assert.equal(isTrusted("1.2.3.5", [parseCidr("1.2.3.4/32")]), false);
});

test("isTrusted: IPv6, including a v4-mapped peer (what a dual-stack socket reports)", () => {
  assert.equal(isTrusted("fd00::1234", [parseCidr("fd00::/8")]), true);
  assert.equal(isTrusted("fe80::1", [parseCidr("fd00::/8")]), false);
  assert.equal(isTrusted("::ffff:10.1.2.3", [parseCidr("10.1.0.0/16")]), true);
  assert.equal(isTrusted("::ffff:10.2.2.3", [parseCidr("10.1.0.0/16")]), false);
});

test("isTrusted: no networks trusts nothing; an unparseable address is never trusted", () => {
  assert.equal(isTrusted("127.0.0.1", []), false);
  for (const bad of ["", "garbage", "10.0.0", "999.1.1.1", undefined as unknown as string]) {
    assert.equal(isTrusted(bad, [parseCidr("0.0.0.0/0"), parseCidr("::/0")]), false, `refuse ${String(bad)}`);
  }
});

test("isTrusted: an IPv6 zone id is ignored, not honoured as a bypass", () => {
  assert.equal(isTrusted("fe80::1%eth0", [parseCidr("fe80::/10")]), true);
  assert.equal(isTrusted("fe80::1%eth0", [parseCidr("fd00::/8")]), false);
});
