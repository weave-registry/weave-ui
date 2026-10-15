/**
 * `bun run build`: the bundle weave's loader reads (ADR-0234 §3 and §7; the table "What the bundle must be" in
 * docs/plans/2026-10-15-weave-ui-phase-2.md) — written into dist/ (or the directory after `--out`):
 *
 * - templates.js: src/templates/index.ts bundled by Bun into ONE plain script ending with `var templates = …;`,
 *   scanned with weave's purity scan (a copy, vendor/weave/purity.ts) before it is written;
 * - assets/: the digest-checked vendored htmx and its SSE extension, weave.css, app.js, the favicon, and one page
 *   shell per core page (assets/pages/<page>.html) made with `layout()` and linted with `lintHtml`;
 * - manifest.json: version, requiresViews, htmx, contract, and every shipped file's sha256.
 *
 * Any problem fails the build (exit code 1) with a message naming it. Runs under Bun (Bun.build); the file work is
 * node: modules. This is a build script, not part of the bundle, so it may use host APIs freely.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NavEntry, RenderCtx } from "../contract/console-views-v1.js";
import { impurity } from "../vendor/weave/purity.js";
import { html } from "../src/html.js";
import { layout } from "../src/layout.js";
import type { LayoutView } from "../src/layout.js";
import type { SafeHtml } from "../src/html.js";
import { lintHtml } from "./lint.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

class BuildError extends Error {}

/** weave's core nav (src/domain/console-api.ts CORE_NAV at c4e6e3a7), copied. */
const CORE_NAV: readonly NavEntry[] = [
  { key: "home", label: "Home", path: "/" },
  { key: "work", label: "Work", path: "/work" },
  { key: "control", label: "Control", path: "/control" },
  { key: "factory", label: "Factory", path: "/factory" },
  { key: "machines", label: "Machines", path: "/machines" },
  { key: "team", label: "Team", path: "/team" },
  { key: "audit", label: "Audit", path: "/audit" },
];

interface PageSpec {
  readonly page: string;
  readonly title: string;
  readonly views: readonly LayoutView[];
  readonly intro?: SafeHtml;
}

const AUDIT_INTRO: SafeHtml = html`<div class="page-head"><h1>Full record</h1><span class="sub">Exactly what a run did, what went wrong, and what it cost — every line traceable to the log.</span></div><div class="card"><form class="pick" data-query-pick hx-get="/ui/f/audit" hx-swap="none"><select name="kind" aria-label="What to look at"><option value="id" selected>A task</option><option value="thread">An issue or conversation</option><option value="since">A time window</option><option value="find">Words to find</option></select><input name="value" aria-label="Which one" placeholder="f2-review-3 · factory:2 · 24h"><button class="btn primary" type="submit">Show</button></form></div>`;

/** The core pages in ADR-0133 order, Home first. */
const PAGES: readonly PageSpec[] = [
  { page: "home", title: "Home", views: [{ name: "home", poll: true }] },
  { page: "work", title: "Work", views: [{ name: "work", poll: true }] },
  { page: "control", title: "Control", views: [{ name: "control", poll: true }] },
  { page: "factory", title: "Factory", views: [{ name: "factory", poll: true }] },
  { page: "machines", title: "Machines", views: [{ name: "fleet", poll: true }, { name: "machines", poll: true }] },
  { page: "team", title: "Team", views: [{ name: "team", poll: true }] },
  { page: "task", title: "Task", views: [{ name: "task", fromLocation: true, poll: true }] },
  { page: "audit", title: "Full record", views: [{ name: "audit", fromLocation: true }], intro: AUDIT_INTRO },
];

interface VendorEntry {
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
}

const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    throw new BuildError(`cannot read ${relative(ROOT, path)}: ${(e as Error).message}`);
  }
}

function outDir(argv: readonly string[]): string {
  const i = argv.indexOf("--out");
  if (i === -1) return join(ROOT, "dist");
  const v = argv[i + 1];
  if (v === undefined || v === "" || v.startsWith("--")) throw new BuildError("--out needs a directory");
  return resolve(v);
}

/** Every file under `dir`, as "/"-separated paths relative to it, sorted. */
function walk(dir: string): string[] {
  const out: string[] = [];
  const go = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) go(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  go(dir);
  return out.sort();
}

/** The bundled ES module turned into one plain script that ends by defining `var templates`. */
function toScript(esm: string, header: string): string {
  const m = /\bexport\s*\{([^}]*)\}\s*;?\s*$/.exec(esm);
  if (m === null) throw new BuildError("bundle: no final export clause");
  let body = esm.slice(0, m.index).replace(/\s+$/, "");
  let local: string | undefined;
  for (const spec of m[1]!.split(",")) {
    const parts = spec.trim().split(/\s+as\s+/);
    const name = parts[0]?.trim();
    const exported = (parts[1] ?? parts[0])?.trim();
    if (exported === "templates") local = name;
  }
  if (local === undefined || local === "") throw new BuildError("bundle: `templates` is not exported by src/templates/index.ts");
  if (local === "templates") {
    if (/^var templates\s*=/m.test(body)) {
      // already a var
    } else if (/^(const|let) templates\s*=/m.test(body)) {
      body = body.replace(/^(const|let) templates(\s*=)/m, "var templates$2");
    } else {
      throw new BuildError("bundle: no top-level declaration of `templates` found");
    }
  } else {
    body += `\nvar templates = ${local};`;
  }
  const stray = /^\s*(import|export)\b.*$/m.exec(body);
  if (stray !== null) throw new BuildError(`bundle: an import/export statement remains: ${stray[0].trim()}`);
  return `${header}\n${body}\n`;
}

async function build(): Promise<void> {
  const out = outDir(process.argv.slice(2));
  const pkg = readJson<{ version?: unknown }>(join(ROOT, "package.json"));
  const version = typeof pkg.version === "string" ? pkg.version : "";
  if (version === "") throw new BuildError("package.json has no version");
  const contractSrc = readFileSync(join(ROOT, "contract", "console-views-v1.d.ts"), "utf8");
  const requiresViews = /export type ConsoleApiVersion = "(\d+\.\d+)";/.exec(contractSrc)?.[1];
  if (requiresViews === undefined) throw new BuildError("contract/console-views-v1.d.ts: no `export type ConsoleApiVersion = \"x.y\";`");
  const vendor = readJson<{ htmx: VendorEntry; sse: VendorEntry }>(join(ROOT, "vendor", "htmx", "VENDOR.json"));
  const source = readJson<{ weaveCommit?: unknown }>(join(ROOT, "contract", "SOURCE.json"));
  if (typeof source.weaveCommit !== "string" || source.weaveCommit === "") throw new BuildError("contract/SOURCE.json has no weaveCommit");

  // 1. A fresh output directory, so nothing stale ships.
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "assets", "pages"), { recursive: true });

  // 2. The bundle, as one plain script.
  const result = await Bun.build({
    entrypoints: [join(ROOT, "src", "templates", "index.ts")],
    format: "esm",
    target: "browser",
    minify: { whitespace: false, syntax: true, identifiers: false },
    sourcemap: "none",
  });
  if (!result.success) throw new BuildError(`bundle failed:\n${result.logs.map(String).join("\n")}`);
  const output = result.outputs[0];
  if (output === undefined) throw new BuildError("bundle produced no output");
  const header = `// weave-ui ${version} templates.js — built for view contract ${requiresViews}. Pure: no I/O, no host objects (ADR-0234 §3).`;
  const script = toScript(await output.text(), header);

  // 3. Purity: the scan weave runs at load.
  const hit = impurity(script);
  if (hit !== null) {
    const line = script.split("\n")[hit.line - 1] ?? "";
    throw new BuildError(`templates.js is impure: '${hit.token}' at line ${hit.line}: ${line.trim()}`);
  }
  writeFileSync(join(out, "templates.js"), script);

  // 4. Assets.
  for (const v of [vendor.htmx, vendor.sse]) {
    const src = join(ROOT, "vendor", "htmx", v.file);
    const digest = sha256(readFileSync(src));
    if (digest !== v.sha256) throw new BuildError(`vendor/htmx/${v.file}: sha256 ${digest} does not match VENDOR.json's ${v.sha256}`);
    copyFileSync(src, join(out, "assets", v.file));
  }
  for (const f of ["weave.css", "app.js", "favicon.svg"]) copyFileSync(join(ROOT, "assets-src", f), join(out, "assets", f));

  // 5. Page shells.
  const ctx: RenderCtx = { api: requiresViews, nav: CORE_NAV };
  for (const p of PAGES) {
    const shell = layout({
      page: p.page,
      title: p.title,
      ctx,
      views: p.views,
      htmxFile: vendor.htmx.file,
      ...(p.intro !== undefined ? { intro: p.intro } : {}),
    });
    const problems = lintHtml(shell);
    if (problems.length > 0) throw new BuildError(`assets/pages/${p.page}.html fails the lint:\n  ${problems.join("\n  ")}`);
    writeFileSync(join(out, "assets", "pages", `${p.page}.html`), shell);
  }

  // 6. The manifest.
  const files: Record<string, string> = {};
  const shipped = ["templates.js", ...walk(join(out, "assets")).map((p) => `assets/${p}`)].sort();
  for (const p of shipped) files[p] = sha256(readFileSync(join(out, p)));
  const manifest = { version, requiresViews, htmx: vendor.htmx.version, contract: source.weaveCommit, files };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // 7. Summary.
  for (const p of [...shipped, "manifest.json"]) console.log(`${p}  ${statSync(join(out, p)).size} B`);
  console.log(`templates.js sha256 ${files["templates.js"]}`);
}

try {
  await build();
} catch (e) {
  console.error(`build: ${e instanceof BuildError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exitCode = 1;
}
