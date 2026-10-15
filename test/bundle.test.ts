/** The built bundle is one weave's loader accepts (ADR-0234 §3, the loader as amended 2026-10-15). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DIST, ROOT, CTX, fixtures, walk, loadBundle } from "./helpers.js";

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
const vendor = JSON.parse(readFileSync(join(ROOT, "vendor", "htmx", "VENDOR.json"), "utf8")) as {
  htmx: { version: string; file: string; sha256: string };
  sse: { version: string; file: string; sha256: string };
};
const contractVersion = /export type ConsoleApiVersion = "(\d+\.\d+)";/.exec(readFileSync(join(ROOT, "contract", "console-views-v1.d.ts"), "utf8"))?.[1];

export const PAGES = ["home", "work", "control", "factory", "machines", "team", "task", "audit"] as const;

interface Manifest {
  version: string;
  requiresViews: string;
  htmx: string;
  files: Record<string, string>;
}
const manifest = (): Manifest => JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8")) as Manifest;

test("dist/ holds templates.js, manifest.json and assets/ — the three things weave's loader reads", () => {
  assert.ok(existsSync(join(DIST, "templates.js")));
  assert.ok(existsSync(join(DIST, "manifest.json")));
  assert.ok(walk(join(DIST, "assets")).length > 0);
});

test("manifest: version from package.json, requiresViews from the vendored contract, the htmx version", () => {
  const m = manifest();
  assert.equal(m.version, pkg.version);
  assert.equal(contractVersion, "1.0");
  assert.equal(m.requiresViews, contractVersion);
  assert.equal(m.htmx, vendor.htmx.version);
});

test("manifest: every shipped file with its sha256, and nothing else", () => {
  const m = manifest();
  const shipped = ["templates.js", ...walk(join(DIST, "assets")).map((p) => `assets/${p}`)].sort();
  assert.deepEqual(Object.keys(m.files).sort(), shipped);
  for (const [p, digest] of Object.entries(m.files)) assert.equal(digest, sha(join(DIST, p)), p);
});

test("assets: htmx and its SSE extension byte-identical to the vendored, digest-checked copies", () => {
  assert.equal(sha(join(DIST, "assets", vendor.htmx.file)), vendor.htmx.sha256);
  assert.equal(sha(join(DIST, "assets", vendor.sse.file)), vendor.sse.sha256);
  assert.equal(vendor.htmx.file, `htmx-${vendor.htmx.version}.min.js`);
});

test("assets: the stylesheet, app.js, the favicon, and one page shell per core page", () => {
  const files = walk(join(DIST, "assets"));
  for (const f of ["weave.css", "app.js", "favicon.svg", ...PAGES.map((p) => `pages/${p}.html`)]) assert.ok(files.includes(f), f);
});

test("templates.js is one plain script: no import/export statement, ends by defining `templates`", () => {
  const src = readFileSync(join(DIST, "templates.js"), "utf8");
  assert.doesNotMatch(src, /^\s*(import|export)\b/m);
  assert.match(src, /\bvar templates\s*=/);
});

test("loaded as weave loads it, `templates` holds `error` and renders it", () => {
  const b = loadBundle();
  assert.ok(b.names.includes("error"), `templates: ${b.names.join(", ")}`);
  const out = b.render("error", { ok: false, error: "no view 'x'", code: "unknown-view", resolution: { code: "unknown-view", commands: [{ run: "weave ui", ready: true }] } });
  assert.match(out, /no view &#39;x&#39;/);
  assert.match(out, /weave ui/);
});

test("every fixture renders through the vm bundle, as a string, inside weave's 50 ms cap", () => {
  const b = loadBundle();
  for (const f of fixtures()) {
    assert.ok(b.names.includes(f.template), `no template '${f.template}' for fixture ${f.template}.${f.name}`);
    b.render(f.template, f.vm, CTX); // warm
    const t0 = performance.now();
    const out = b.render(f.template, f.vm, CTX, 50);
    assert.equal(typeof out, "string");
    assert.ok(performance.now() - t0 < 50, `${f.template}.${f.name}`);
    assert.ok(Buffer.byteLength(out) < 2 * 1024 * 1024, `${f.template}.${f.name} under 2 MiB`);
  }
});

test("no host object is reachable from the bundle's context", () => {
  const b = loadBundle();
  assert.ok(b.names.length > 0);
  const probe = loadBundle(`var templates = { probe: function () { return [typeof process, typeof require, typeof console, typeof setTimeout, typeof fetch].join(","); } };`);
  assert.equal(probe.render("probe", {}), "undefined,undefined,undefined,undefined,undefined");
});
