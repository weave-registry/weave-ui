/**
 * The proof that weave's OWN loader accepts this repository's build (ADR-0234 Phase 2).
 *
 * Usage: `node --import tsx scripts/weave-loader-proof.ts <weave checkout> [dist dir, default ./dist]`.
 *
 * ADR-0234 §2: neither repository imports the other's code. So weave's loader is not a dependency of weave-ui — this
 * script imports it at RUN time, from the weave checkout named on the command line, and types it locally with the
 * minimal interface it calls. CI has no weave checkout, so this proof runs locally and its output is recorded in the PR.
 *
 * It loads dist/ pinned to the manifest's templates.js sha256, renders every fixture in test/fixtures/<template>.<case>.json
 * with weave's core nav, checks every manifest asset's sha256 against what the loader serves, and prints weave's git HEAD
 * and node's version. Any failure sets process.exitCode = 1.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Render =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly code: string; readonly reason: string };

interface Templates {
  readonly version: string;
  readonly requiresViews: string;
  readonly source: string;
  render(name: string, vm: unknown, ctx: unknown): Render;
  asset(path: string): { readonly body: Uint8Array; readonly contentType: string } | null;
}

type Load =
  | { readonly ok: true; readonly sha256: string; readonly templates: Templates }
  | { readonly ok: false; readonly code: string; readonly reason: string };

interface LoaderModule {
  loadConsoleBundle(dir: string, opts: { readonly expectSha256?: string }): Load;
}

interface Manifest {
  readonly files: Readonly<Record<string, string>>;
}

/** weave's core nav (src/domain/console-api.ts CORE_NAV), in display order. */
const NAV = [
  { key: "home", label: "Home", path: "/" },
  { key: "work", label: "Work", path: "/work" },
  { key: "control", label: "Control", path: "/control" },
  { key: "factory", label: "Factory", path: "/factory" },
  { key: "machines", label: "Machines", path: "/machines" },
  { key: "team", label: "Team", path: "/team" },
  { key: "audit", label: "Audit", path: "/audit" },
] as const;

const FIXTURES = resolve(import.meta.dirname, "../test/fixtures");

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

async function main(): Promise<void> {
  const [weaveArg, distArg] = process.argv.slice(2);
  if (weaveArg === undefined) {
    console.error("usage: node --import tsx scripts/weave-loader-proof.ts <weave checkout> [dist dir]");
    process.exitCode = 1;
    return;
  }
  const weaveDir = resolve(weaveArg);
  const distDir = resolve(distArg ?? "dist");
  let failed = false;

  const manifest = JSON.parse(readFileSync(join(distDir, "manifest.json"), "utf8")) as Manifest;
  const expectSha256 = manifest.files["templates.js"];
  if (expectSha256 === undefined) {
    console.error("manifest.json has no templates.js entry");
    process.exitCode = 1;
    return;
  }

  const loaderUrl = pathToFileURL(join(weaveDir, "src/adapters/secondary/console-ui-bundle.ts")).href;
  const loader = (await import(loaderUrl)) as LoaderModule;
  const load = loader.loadConsoleBundle(distDir, { expectSha256 });
  if (!load.ok) {
    console.log(`load: refused ${load.code}: ${load.reason}`);
    process.exitCode = 1;
    return;
  }
  const t = load.templates;
  console.log(`load: ok sha256=${load.sha256}`);
  console.log(`  version=${t.version} requiresViews=${t.requiresViews} source=${t.source}`);

  const ctx = { api: "1.0", nav: NAV, user: "proof" };
  const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).sort();
  for (const file of fixtures) {
    const label = file.slice(0, -".json".length);
    const template = label.slice(0, label.indexOf(".") === -1 ? undefined : label.indexOf("."));
    const vm: unknown = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
    const r = t.render(template, vm, ctx);
    if (r.ok) {
      console.log(`${label}: ok ${Buffer.byteLength(r.html, "utf8")} B`);
    } else {
      console.log(`${label}: FAIL ${r.code}: ${r.reason}`);
      failed = true;
    }
  }

  let assets = 0;
  for (const [key, expected] of Object.entries(manifest.files)) {
    if (!key.startsWith("assets/")) continue;
    const a = t.asset(key.slice("assets/".length));
    if (a === null) {
      console.log(`asset ${key}: FAIL not served`);
      failed = true;
    } else if (sha256(a.body) !== expected) {
      console.log(`asset ${key}: FAIL sha256 ${sha256(a.body)} != manifest ${expected}`);
      failed = true;
    } else {
      assets++;
    }
  }
  console.log(`assets: ${assets} match the manifest`);

  const head = spawnSync("git", ["-C", weaveDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const rev = head.status === 0 ? head.stdout.trim() : "unknown";
  console.log(`weave HEAD: ${rev}`);
  console.log(`node: ${process.version}`);

  if (failed) {
    console.log("weave loader proof: FAIL");
    process.exitCode = 1;
  } else {
    console.log("weave loader proof: PASS");
  }
}

await main();
