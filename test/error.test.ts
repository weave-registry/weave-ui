/** The `error` template: every refusal from /ui (ErrorView), with its ADR-0122 resolution. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { templates } from "../src/templates/index.js";
import { CTX } from "./helpers.js";

const render = (vm: unknown): string => (templates as Record<string, (v: unknown, c: unknown) => string>).error!(vm, CTX);

test("an error renders into the page's error region, out of band, as an alert", () => {
  const out = render({ ok: false, error: "no view 'nope'", code: "unknown-view", resolution: { code: "unknown-view", commands: [{ run: "weave ui", ready: true }] } });
  assert.match(out, /^<div id="weave-error" class="problem" role="alert" hx-swap-oob="true"/);
  assert.match(out, /no view &#39;nope&#39;/);
  assert.match(out, /data-code="unknown-view"/);
  assert.match(out, /<code>weave ui<\/code>/);
});

test("a command that needs a value says which value", () => {
  const out = render({
    ok: false,
    error: "the console UI bundle is not loaded",
    code: "templates-unavailable",
    resolution: { code: "templates-unavailable", commands: [{ run: "weave dev --console-ui <dir>", ready: false, why: "a weave-ui build directory" }] },
  });
  assert.match(out, /<code>weave dev --console-ui &lt;dir&gt;<\/code>/);
  assert.match(out, /a weave-ui build directory/);
});

test("a malformed error still renders (no resolution, no commands)", () => {
  const out = render({ ok: false, error: "x", code: "view-failed" });
  assert.match(out, /role="alert"/);
});
