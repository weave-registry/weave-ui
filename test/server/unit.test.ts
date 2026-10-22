/**
 * #8 / weave ADR-0245 §2–§3 — the systemd user unit template, deploy/systemd/weave-ui.service: weave-ui runs as its
 * own user service, and its console secret arrives only through `weave secret exec` (ADR-0100) — never in the unit, an
 * EnvironmentFile or any env file on disk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../helpers.js";

const unit = (): string => readFileSync(join(ROOT, "deploy", "systemd", "weave-ui.service"), "utf8");
const lines = (): string[] => unit().split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
const key = (k: string): string[] => lines().filter((l) => l.startsWith(`${k}=`)).map((l) => l.slice(k.length + 1));

test("it has the three sections of a user service, started with the user's session", () => {
  const u = unit();
  for (const s of ["[Unit]", "[Service]", "[Install]"]) assert.ok(u.includes(s), s);
  assert.deepEqual(key("WantedBy"), ["default.target"]);
  assert.ok(key("Description")[0]?.includes("weave-ui"));
});

test("ExecStart runs serve.ts under `weave secret exec WEAVE_CONSOLE_SECRET --`, so the secret is injected at start", () => {
  const exec = key("ExecStart");
  assert.equal(exec.length, 1);
  assert.match(exec[0]!, /\bweave secret exec WEAVE_CONSOLE_SECRET -- /);
  assert.match(exec[0]!, /src\/server\/serve\.ts/);
});

test("the secret is never written into the unit or an env file", () => {
  assert.equal(key("EnvironmentFile").length, 0, "no EnvironmentFile");
  for (const e of key("Environment")) assert.doesNotMatch(e, /WEAVE_CONSOLE_SECRET|SECRET|TOKEN/, e);
  assert.doesNotMatch(lines().join("\n"), /WEAVE_CONSOLE_SECRET=/);
});

test("WEAVE_URL is set in the unit and restarts are bounded", () => {
  assert.ok(key("Environment").some((e) => /^"?WEAVE_URL=https?:\/\//.test(e)), "WEAVE_URL");
  assert.deepEqual(key("Restart"), ["on-failure"]);
  assert.ok(key("RestartSec").length === 1);
});

test("it is hardened: no new privileges, a private /tmp, a read-only system", () => {
  assert.deepEqual(key("NoNewPrivileges"), ["yes"]);
  assert.deepEqual(key("PrivateTmp"), ["yes"]);
  assert.deepEqual(key("ProtectSystem"), ["strict"]);
});
