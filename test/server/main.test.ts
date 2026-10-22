/**
 * #8 / weave ADR-0245 §2 — `startServer`: config from the environment, the upstream client, the changes hub and the
 * HTTP server wired together, end to end against a stub weave. `--insecure-upstream` is the only way to plain http on
 * a non-loopback weave, and is named in the banner and /health. The secret never reaches a log line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server/main.js";
import { startStubWeave } from "./stub-weave.js";
import { ROOT } from "../helpers.js";

const SECRET = "console-secret-0123456789abcdefghijklmnop";

function assetsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wui-assets-"));
  mkdirSync(join(dir, "pages"));
  for (const p of ["home", "work", "control", "factory", "machines", "team", "task", "audit"]) writeFileSync(join(dir, "pages", `${p}.html`), `shell:${p}`);
  return dir;
}

test("startServer serves pages and fragments rendered from the stub weave, over loopback http", async () => {
  const weave = await startStubWeave({ secret: SECRET });
  weave.setView("home", JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "home.full.json"), "utf8")));
  const lines: string[] = [];
  const srv = await startServer({ env: { WEAVE_URL: weave.url, WEAVE_CONSOLE_SECRET: SECRET }, argv: [], listenPort: 0, assetsDir: assetsDir(), log: (l) => lines.push(l) });
  try {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await fetch(`${srv.url}/`);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "shell:home");
    const frag = await fetch(`${srv.url}/ui/f/home`);
    assert.equal(frag.status, 200);
    assert.match(await frag.text(), /id="view-home"/);
    const seen = weave.seen.find((q) => q.url.startsWith("/api/v1/home"))!;
    assert.equal(seen.headers["x-weave-secret"], SECRET, "the credential goes upstream as a header");
    assert.equal(seen.headers.cookie, undefined, "the browser's cookie never goes upstream");
    const health = (await (await fetch(`${srv.url}/health`)).json()) as { ok: boolean; insecureUpstream: boolean };
    assert.deepEqual([health.ok, health.insecureUpstream], [true, false]);
    assert.ok(lines.some((l) => l.includes(srv.url)), "the banner names where it listens");
    assert.ok(lines.every((l) => !l.includes(SECRET)), "no log line carries the secret");
  } finally {
    await srv.close();
    await weave.close();
  }
});

test("a plain-http weave off loopback is refused at start unless --insecure-upstream, which the banner and /health name", async () => {
  const env = { WEAVE_URL: "http://10.255.255.1:9", WEAVE_CONSOLE_SECRET: SECRET };
  await assert.rejects(startServer({ env, argv: [], listenPort: 0, assetsDir: assetsDir(), log: () => {} }), /insecure/i);
  const lines: string[] = [];
  const srv = await startServer({ env, argv: ["--insecure-upstream"], listenPort: 0, assetsDir: assetsDir(), log: (l) => lines.push(l) });
  try {
    const health = (await (await fetch(`${srv.url}/health`)).json()) as { insecureUpstream: boolean };
    assert.equal(health.insecureUpstream, true);
    assert.ok(lines.some((l) => /insecure/i.test(l)), "the banner says so");
    assert.ok(lines.every((l) => !l.includes(SECRET)));
  } finally {
    await srv.close();
  }
});

test("a bad configuration stops the server with a message that never contains the secret", async () => {
  await assert.rejects(
    startServer({ env: { WEAVE_CONSOLE_SECRET: SECRET }, argv: [], listenPort: 0, assetsDir: assetsDir(), log: () => {} }),
    (e: unknown) => e instanceof Error && /WEAVE_URL/.test(e.message) && !e.message.includes(SECRET),
  );
  await assert.rejects(startServer({ env: { WEAVE_URL: "http://127.0.0.1:9", WEAVE_CONSOLE_SECRET: SECRET }, argv: ["--bogus"], listenPort: 0, assetsDir: assetsDir(), log: () => {} }));
});

test("close() stops the server and the hub", async () => {
  const weave = await startStubWeave({ secret: SECRET });
  const srv = await startServer({ env: { WEAVE_URL: weave.url, WEAVE_CONSOLE_SECRET: SECRET }, argv: [], listenPort: 0, assetsDir: assetsDir(), log: () => {} });
  await srv.close();
  await assert.rejects(fetch(`${srv.url}/health`));
  await weave.close();
});
