/** #8 — `bun run serve` / `node --import tsx src/server/serve.ts`: the process entry starts the server from the
 *  environment, answers /health, and exits 0 on SIGTERM; a bad configuration exits non-zero without the secret. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startStubWeave } from "./stub-weave.js";
import { ROOT } from "../helpers.js";

const SECRET = "console-secret-0123456789abcdefghijklmnop";

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

test("package.json's serve script runs src/server/serve.ts", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["serve"] ?? "", /src\/server\/serve\.ts/);
});

test("serve.ts starts from the environment, answers /health, and exits 0 on SIGTERM", async () => {
  const weave = await startStubWeave({ secret: SECRET });
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", join(ROOT, "src", "server", "serve.ts")], {
    cwd: ROOT,
    env: { ...process.env, WEAVE_URL: weave.url, WEAVE_CONSOLE_SECRET: SECRET, WEAVE_UI_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  try {
    const end = Date.now() + 15000;
    while (!out.includes("listening")) {
      if (Date.now() > end || child.exitCode !== null) assert.fail(`no banner: ${out}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    const h = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { ok: boolean };
    assert.equal(h.ok, true);
    const code = await new Promise<number | null>((resolve) => {
      child.once("exit", (c) => resolve(c));
      child.kill("SIGTERM");
    });
    assert.equal(code, 0);
    assert.ok(!out.includes(SECRET), "no output carries the secret");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await weave.close();
  }
});

test("serve.ts exits non-zero on a bad configuration, naming the problem but never the secret", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", join(ROOT, "src", "server", "serve.ts")], {
    cwd: ROOT,
    env: { ...process.env, WEAVE_URL: "", WEAVE_CONSOLE_SECRET: SECRET },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code = await new Promise<number | null>((resolve) => child.once("exit", (c) => resolve(c)));
  assert.notEqual(code, 0);
  assert.match(out, /WEAVE_URL/);
  assert.ok(!out.includes(SECRET));
});
