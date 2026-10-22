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

test("Home's controls: the yolo switch, the spend head, and compact buttons inside a list row", () => {
  const css = uncommented(src);
  assert.match(css, /\.view\.home \.switch\s*\{[^}]*width:\s*44px/, "the switch is a 44px toggle");
  assert.match(css, /\.view\.home \.switch::after\s*\{/, "the switch has a knob");
  assert.match(css, /\.view\.home \.fleet-controls\[data-on="true"\] \.switch\s*\{[^}]*var\(--needs-fill\)/, "on is amber");
  assert.match(css, /\.view\.home \.spend-head\s*\{[^}]*justify-content:\s*space-between/);
  assert.match(css, /\.lrow-acts \.btn\s*\{[^}]*min-height:\s*28px/);
});

test("the favicon is the redesign's mark: the amber wave on the ground", () => {
  const svg = readFileSync(join(ROOT, "assets-src", "favicon.svg"), "utf8");
  assert.match(svg, /M3 7c3 0 3 10 6 10s3-10 6-10 3 10 6 10/);
  assert.match(svg, /#f2a93b/i);
  assert.match(svg, /#0e1014/i);
  assert.doesNotMatch(svg, /--/, "no double hyphen: an <img> SVG is strict XML");
});

test("Work and Machines (PR 2): the board, cards and state chips, slot strips, host cards, telemetry tiles", () => {
  const css = uncommented(src);
  for (const sel of [".view.work .board-cols", ".view.work .col", ".view.work .col-head", ".view.work .wcard", ".view.work .wcard-top", ".view.work .wcard-title", ".view.work .wcard-note", ".view.work .wcard-foot", ".view.work .work-lower", ".view.work .slots", ".view.work .slot", ".view.work .slot-doing", ".view.machines-view .hosts", ".view.machines-view .host-card", ".view.machines-view .host-heard"]) {
    assert.ok(css.includes(sel), `no rule for ${sel}`);
  }
  for (const s of ["held", "waiting", "running", "queued"]) {
    assert.match(css, new RegExp(`\\.view\\.work \\.wcard\\[data-state="${s}"\\]`), `card ${s}`);
    assert.match(css, new RegExp(`\\.view\\.work \\.state\\[data-state="${s}"\\]`), `chip ${s}`);
  }
  assert.match(css, /\.view\.work \.slot\[data-busy="true"\]\s*\{[^}]*var\(--work-fill\)/);
  for (const sel of [".telemetry", ".tele", ".tele-head", ".tele-stats", ".stat", ".stat-label", ".stat-value", ".stat-sub", ".grow"]) assert.ok(has(sel), `no rule for ${sel}`);
});

test("build: the minifier also drops the space after a declaration's colon (the size budget is tight)", () => {
  const out = built();
  assert.doesNotMatch(out, /[{;](--[a-z0-9-]+|[a-z-]+):\s/, "a declaration keeps a space after its colon");
});

test("polish: the sidebar's ground runs the page's full height, board cards clamp their title and note, the scopes sit apart", () => {
  const css = uncommented(src);
  assert.match(css, /\.app\s*\{[^}]*background:\s*linear-gradient\(to right, var\(--side\) 232px/);
  assert.match(css, /\.view\.work \.wcard-title[^{]*\{[^}]*-webkit-line-clamp:\s*3/);
  assert.match(css, /\.view\.work \.wcard-note[^{]*\{[^}]*-webkit-line-clamp:\s*2/);
  assert.match(css, /\.view\.fleet\s*\{[^}]*margin-top:\s*20px/);
});

test("PR 3: the numbers row (.stats) is shared by every page head, with its tones", () => {
  const css = uncommented(src);
  assert.ok(has(".stats"), "a global .stats rule");
  for (const t of ["ok", "needs", "bad"]) assert.match(css, new RegExp(`(^|[},\\s])\\.stats b\\.${t}\\s*[,{]`, "m"), `.stats b.${t}`);
  assert.doesNotMatch(css, /\.view\.work \.stats/, "Work's copy is the shared one now");
});
