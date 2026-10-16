/** src/ui/format.ts — the formatting the weave pages used (dom-js.ts money/plural/ago/dur), as pure functions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { money, plural, ago, dur, time, stageName, stageVerb, toolPhrase } from "../src/ui/format.js";
import { toHtml } from "../src/html.js";

test("money: two places, <$0.01 for a sliver, $0.00 for nothing", () => {
  assert.equal(money(1.234), "$1.23");
  assert.equal(money(0.004), "<$0.01");
  assert.equal(money(0), "$0.00");
  assert.equal(money(null), "$0.00");
  assert.equal(money("x"), "$0.00");
});

test("plural", () => {
  assert.equal(plural(1, "slot"), "1 slot");
  assert.equal(plural(3, "slot"), "3 slots");
  assert.equal(plural(0, "agent"), "0 agents");
  assert.equal(plural(2, "proxy", "proxies"), "2 proxies");
});

test("dur and ago use weave's buckets", () => {
  assert.equal(dur(45_000), "45s");
  assert.equal(dur(5 * 60_000), "5m");
  assert.equal(dur(3 * 3_600_000), "3h");
  assert.equal(dur(3 * 86_400_000), "3d");
  const now = 1_800_000_000_000;
  assert.equal(ago(now - 5_000, now), "just now");
  assert.equal(ago(now - 120_000, now), "2m ago");
  assert.equal(ago(now + 120_000, now), "in 2m");
  assert.match(ago(now - 10 * 86_400_000, now), /^\d{1,2} [A-Z][a-z]{2}$/);
});

test("time renders a <time> app.js re-renders in the browser's own zone", () => {
  const now = 1_800_000_000_000;
  assert.equal(toHtml(time(now - 120_000, { now })), `<time datetime="${new Date(now - 120_000).toISOString()}" data-ts="${now - 120_000}" data-fmt="ago">2m ago</time>`);
  assert.match(toHtml(time(now + 60_000, { now, fmt: "until" })), /data-fmt="until"/);
  assert.equal(toHtml(time(undefined)), "");
  assert.equal(toHtml(time(Number.NaN)), "");
});

test("stages and tools speak like the factory page", () => {
  assert.equal(stageName("build"), "Build");
  assert.equal(stageVerb("plan"), "write the plan and the test that proves it");
  assert.equal(stageName("weird"), "weird");
  assert.equal(stageVerb("weird"), "run");
  assert.equal(toolPhrase("bash"), "wants to run a command");
  assert.equal(toolPhrase("hexa_build"), "wants to use hexa (build) — this spends Claude credits");
  assert.equal(toolPhrase("custom"), "wants to use custom");
  assert.equal(toolPhrase(undefined), "wants to use a tool");
});
