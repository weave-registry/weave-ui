/**
 * Fixes from the 0.1.0 design review (docs/design-review-0.1.0.md) — each held by a test so it cannot regress.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { panel } from "../src/ui/panel.js";
import { toHtml } from "../src/html.js";
import { CTX, ROOT, fixtures } from "./helpers.js";

const T = templates as Record<string, (v: unknown, c: unknown) => string>;
const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));
const css = readFileSync(join(ROOT, "assets-src", "weave.css"), "utf8");

test("Control can stop the fleet: Halt on the running card, the yolo switch on the autonomy card", () => {
  const live = T.control!(fx("control.live"), CTX);
  assert.match(live, /hx-post="\/ui\/a\/fleet"[^>]*data-confirm="Halt the fleet\?[^"]*"><input type="hidden" name="@" value="halt"><button class="btn danger" type="submit">■ Halt<\/button>/);
  assert.match(live, /hx-post="\/ui\/a\/yolo"[^>]*><input type="hidden" name="on:bool" value="true">/);
  const full = T.control!(fx("control.full"), CTX);
  assert.match(full, /<input type="hidden" name="off:bool" value="true">/);
});

test("Home: Halt and Resume are their CLI commands as text (ADR-0245 §3), and one set of fleet controls", () => {
  const live = T.home!(fx("home.live"), CTX);
  assert.match(live, /Halt from the command line: <code>weave halt<\/code>/);
  const halted = T.home!(fx("home.halted"), CTX);
  assert.match(halted, /Resume from the command line: <code>weave resume<\/code>/);
  const resumes = (halted.match(/<code>weave resume<\/code>/g) ?? []).length;
  assert.ok(resumes <= 2, `${resumes} Resume commands on a halted Home`);
});

test("no page posts the fleet action: the console credential may not halt or resume (ADR-0245 §3)", () => {
  for (const f of fixtures()) {
    const out = T[f.template]!(f.vm, CTX);
    assert.doesNotMatch(out, /\/ui\/a\/fleet"/, `${f.template}.${f.name}`);
  }
});

test("no link into a dropped page: no bare /task, no /knowledge", () => {
  for (const f of fixtures()) {
    const out = T[f.template]!(f.vm, CTX);
    assert.doesNotMatch(out, /href="\/task"/, `${f.template}.${f.name}`);
    assert.doesNotMatch(out, /href="\/knowledge/, `${f.template}.${f.name}`);
  }
});

test("panel chart bars carry their tone on the <meter> the stylesheet colours", () => {
  assert.match(toHtml(panel({ type: "show_chart", series: [{ label: "a", value: 1, status: "fail" }] })), /<meter [^>]*data-tone="bad"/);
});

test("weave.css: no nav tab is hidden on a phone (Control and Team have no other way in)", () => {
  assert.doesNotMatch(css, /\.nav a\[data-key="(team|control)"\][^{]*\{\s*display:\s*none/);
});

test("weave.css: the copied page blocks are scoped to their view, so one page's .row cannot restyle another's", () => {
  const start = css.indexOf("/* ═══ Page styles");
  const end = css.indexOf("/* ═══ weave-ui adaptations");
  assert.ok(start > 0 && end > start);
  const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const bad: string[] = [];
  for (const m of block.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
    for (const sel of m[2]!.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!/^(\.view\.[a-z-]+|#view-[a-z]+)\b/.test(sel)) bad.push(sel);
    }
  }
  assert.deepEqual(bad, []);
});

test("weave.css styles the fleet controls, number inputs and the autonomy tone", () => {
  for (const sel of [".fleet-controls", ".yolo-pick", 'input[type="number"]', '.status[data-tone="auto"]']) assert.ok(css.includes(sel), sel);
});
