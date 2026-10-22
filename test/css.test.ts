/**
 * The stylesheet of the redesign (docs/plans/2026-10-23-redesign.md): how the build ships it, and the system the
 * templates and the page shells rely on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIST, ROOT } from "./helpers.js";

const src = readFileSync(join(ROOT, "assets-src", "weave.css"), "utf8");
const built = (): string => readFileSync(join(DIST, "assets", "weave.css"), "utf8");
const uncommented = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("build: dist/assets/weave.css is the source minified — no comments, no newlines, every rule and declaration kept", () => {
  const out = built();
  assert.doesNotMatch(out, /\/\*/, "a comment survived");
  assert.doesNotMatch(out, /\n/, "a newline survived");
  assert.ok(out.length < src.length, `${out.length} B is not smaller than the source's ${src.length} B`);
  const count = (css: string, ch: string): number => css.split(ch).length - 1;
  const plain = uncommented(src);
  for (const ch of ["{", "}", ";", ":"]) assert.equal(count(out, ch), count(plain, ch), `the number of '${ch}' changed`);
  // Values keep their inner spaces: a minifier must not glue `1px solid` into `1pxsolid`.
  const decls = (css: string): string[] => [...css.matchAll(/(--[a-z0-9-]+|[a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => `${m[1]}:${m[2]!.trim().replace(/\s+/g, " ")}`);
  assert.deepEqual(decls(out), decls(plain));
});

const has = (sel: string): boolean => new RegExp(`(^|[}\\s,])${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s,{:[>.]`, "m").test(uncommented(src));

test("the shell: sidebar, nav groups and live slots, network chip, sidebar foot, top bar with breadcrumb and search", () => {
  for (const sel of [".app", ".side", ".brand", ".mark", ".net", ".nav", ".nav-group", ".nav-meta", ".side-foot", ".side-row", ".side-halt", ".frame", ".topbar", ".crumb", ".search"]) {
    assert.ok(has(sel), `no rule for ${sel}`);
  }
});

test("the system: panels, pills, chips, dots, tags, KPI tiles, list rows, bars, the health banner, buttons", () => {
  for (const sel of [".panel", ".panel-head", ".panel-link", ".pill", ".chip", ".chips", ".dot", ".tag", ".kpis", ".kpi", ".kpi-label", ".kpi-value", ".kpi-sub", ".lrows", ".lrow", ".lrow-title", ".lrow-why", ".lrow-meta", ".lrow-acts", "meter.bar", ".health", ".health-title", ".health-sub", ".btn", ".btn.primary", ".btn.danger", ".btn.sm", ".empty"]) {
    assert.ok(has(sel), `no rule for ${sel}`);
  }
  for (const tone of ["ok", "work", "needs", "bad"]) {
    assert.match(uncommented(src), new RegExp(`\\.dot\\[data-tone="${tone}"\\]`), `.dot tone ${tone}`);
    assert.match(uncommented(src), new RegExp(`\\.pill\\[data-tone="${tone}"\\]`), `.pill tone ${tone}`);
  }
  for (const v of ["halted", "degraded", "working", "idle"]) assert.match(uncommented(src), new RegExp(`\\.health\\[data-verdict="${v}"\\]`), `.health ${v}`);
});

test("Home's layout: the KPI strip, the needs list beside the side column, the lower row with Ask weave", () => {
  for (const sel of [".view.home .home-grid", ".view.home .home-side", ".view.home .home-lower", ".view.home .host", ".view.home .hbar", ".view.home .switch-row", ".view.home .chat"]) {
    assert.ok(uncommented(src).includes(sel), `no rule for ${sel}`);
  }
});

test("nav icons are CSS masks from data: SVGs keyed on data-key — one per core page, no markup per icon", () => {
  const css = uncommented(src);
  for (const key of ["home", "work", "factory", "audit", "machines", "team", "control"]) {
    assert.match(css, new RegExp(`\\[data-key="${key}"\\][^{]*\\{[^}]*mask(-image)?:\\s*url\\("data:image/svg\\+xml`), `no icon for ${key}`);
  }
});

test("on every page but Home the hidden Home feed stays hidden", () => {
  assert.match(uncommented(src), /body:not\(\[data-shell="home"\]\) #view-home\s*\{[^}]*display:\s*none/);
});

test("on a phone the sidebar stacks above the content", () => {
  const css = uncommented(src);
  const media = [...css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/g)];
  assert.ok(media.some((m) => /\.app\s*\{[^}]*(display:\s*block|flex-direction:\s*column|grid-template-columns:\s*1fr)/.test(m[2]!)), "no phone rule that stacks .app");
});

test("nothing loads from elsewhere and no webfont ships: no @import, no @font-face, no http(s) url", () => {
  const css = uncommented(src);
  assert.doesNotMatch(css, /@import/);
  assert.doesNotMatch(css, /@font-face/);
  assert.doesNotMatch(css, /url\(\s*["']?https?:/i);
});

test("every colour literal lives in :root — rules use the tokens", () => {
  const css = uncommented(src).replace(/:root \{[\s\S]*?\n\}/, "").replace(/url\("data:[^"]*"\)/g, "url()");
  const hex = [...css.matchAll(/([a-z-]+)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}\b[^;{}]*);/g)].map((m) => `${m[1]}: ${m[2]}`);
  assert.deepEqual(hex, []);
});
