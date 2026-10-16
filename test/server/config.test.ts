/** #8 — the server's configuration: WEAVE_URL + WEAVE_CONSOLE_SECRET from the environment, never from a file. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig, ConfigError } from "../../src/server/config.js";

const ENV = { WEAVE_URL: "https://weave.lan:8443/", WEAVE_CONSOLE_SECRET: "s3cret-value" };

test("a minimal environment gives a config with defaults: loopback, an own port, no trusted networks", () => {
  const c = loadConfig(ENV);
  assert.equal(c.weaveUrl, "https://weave.lan:8443");
  assert.equal(c.secret, "s3cret-value");
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.port, 8790);
  assert.deepEqual(c.trustCidrs, []);
});

test("WEAVE_URL may point at another host, over http or https; anything else is refused", () => {
  assert.equal(loadConfig({ ...ENV, WEAVE_URL: "http://10.0.0.7:8787" }).weaveUrl, "http://10.0.0.7:8787");
  assert.equal(loadConfig({ ...ENV, WEAVE_URL: "https://weave.example.org" }).weaveUrl, "https://weave.example.org");
  for (const bad of ["", "weave.lan", "ftp://weave.lan", "file:///etc/passwd", "https://u:p@weave.lan", "https://weave.lan/?x=1", "https://weave.lan/#f"]) {
    assert.throws(() => loadConfig({ ...ENV, WEAVE_URL: bad }), ConfigError, `refuse ${JSON.stringify(bad)}`);
  }
  assert.throws(() => loadConfig({ WEAVE_CONSOLE_SECRET: "x" }), /WEAVE_URL/);
});

test("WEAVE_CONSOLE_SECRET is required, and no error message ever contains it", () => {
  assert.throws(() => loadConfig({ WEAVE_URL: ENV.WEAVE_URL }), /WEAVE_CONSOLE_SECRET/);
  assert.throws(() => loadConfig({ ...ENV, WEAVE_CONSOLE_SECRET: "   " }), /WEAVE_CONSOLE_SECRET/);
  for (const bad of ["ftp://leaky-s3cret-value", "https://u:s3cret-value@weave.lan"]) {
    try {
      loadConfig({ ...ENV, WEAVE_URL: bad });
      assert.fail("should refuse");
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.doesNotMatch(String((e as Error).message), /s3cret-value/);
    }
  }
});

test("the secret has no *_FILE form and the module reads no file: the sealed store is the only source", () => {
  assert.throws(() => loadConfig({ WEAVE_URL: ENV.WEAVE_URL, WEAVE_CONSOLE_SECRET_FILE: "/etc/secret" } as never), /WEAVE_CONSOLE_SECRET/);
  const src = readFileSync(new URL("../../src/server/config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /readFile|readFileSync|node:fs|createReadStream/);
});

test("the listening port and host come from WEAVE_UI_PORT and WEAVE_UI_HOST, validated", () => {
  const c = loadConfig({ ...ENV, WEAVE_UI_PORT: "9100", WEAVE_UI_HOST: "0.0.0.0" });
  assert.equal(c.port, 9100);
  assert.equal(c.host, "0.0.0.0");
  for (const bad of ["0", "65536", "-1", "80.5", "abc", ""]) {
    assert.throws(() => loadConfig({ ...ENV, WEAVE_UI_PORT: bad }), ConfigError, `refuse port ${JSON.stringify(bad)}`);
  }
});

test("--trust-cidr (repeatable, also `--trust-cidr=…`) and WEAVE_UI_TRUST_CIDR (comma list) both add trusted networks", () => {
  const a = loadConfig(ENV, ["--trust-cidr", "10.0.0.0/8", "--trust-cidr=192.168.0.0/16"]);
  assert.equal(a.trustCidrs.length, 2);
  const b = loadConfig({ ...ENV, WEAVE_UI_TRUST_CIDR: "10.0.0.0/8, fd00::/8" });
  assert.equal(b.trustCidrs.length, 2);
  const c = loadConfig({ ...ENV, WEAVE_UI_TRUST_CIDR: "10.0.0.0/8" }, ["--trust-cidr", "172.16.0.0/12"]);
  assert.equal(c.trustCidrs.length, 2);
});

test("a bad --trust-cidr, a missing value, or an unknown flag stops the server rather than being ignored", () => {
  assert.throws(() => loadConfig(ENV, ["--trust-cidr", "nonsense"]), ConfigError);
  assert.throws(() => loadConfig(ENV, ["--trust-cidr"]), ConfigError);
  assert.throws(() => loadConfig(ENV, ["--no-such-flag"]), ConfigError);
});
