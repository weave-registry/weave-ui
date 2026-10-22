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
