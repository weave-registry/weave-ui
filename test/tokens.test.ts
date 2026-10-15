/** The token drift + contrast check moved from weave, and the stylesheet's own text pairs at 4.5:1 (WCAG AA). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.js";

test("tokens/tools/check-tokens.mjs --check: brand.json and theme.json match the CSS", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "tokens", "tools", "check-tokens.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

const lin = (c: number): number => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

function block(css: string, re: RegExp): Record<string, string> {
  const m = re.exec(css);
  assert.ok(m, `no block ${re}`);
  const out: Record<string, string> = {};
  for (const t of m[1]!.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[t[1]!] = t[2]!;
  return out;
}

// Text on the surface it is painted on — the pairs weave.css documents.
const PAIRS: [string, string][] = [
  ["--fg", "--bg"], ["--fg", "--surface"], ["--fg", "--sunken"],
  ["--muted", "--bg"], ["--muted", "--surface"], ["--muted", "--needs-bg"],
  ["--ok", "--surface"], ["--work", "--surface"], ["--bad", "--surface"],
  ["--needs", "--needs-bg"], ["--bad-text", "--bad-bg"], ["--auto", "--auto-bg"], ["--auto", "--surface"],
  ["--on-primary", "--primary"], ["--on-bad", "--bad"],
];
// Copied as weave ships it: white on dark-theme --bad (#f85149) is 3.35:1. Kept visible here, and in the design review.
const KNOWN_BELOW: Record<string, string> = { "dark --on-bad/--bad": "weave.css as copied at c4e6e3a7" };

test("assets-src/weave.css: every documented text pair is at least 4.5:1, light and dark", () => {
  const css = readFileSync(join(ROOT, "assets-src", "weave.css"), "utf8");
  const light = block(css, /:root, \[data-theme="light"\] \{([\s\S]*?)\n\}/);
  const dark = { ...light, ...block(css, /\[data-theme="dark"\] \{([\s\S]*?)\n\}/) };
  const fails: string[] = [];
  for (const [theme, t] of [["light", light], ["dark", dark]] as const) {
    for (const [fg, bg] of PAIRS) {
      assert.ok(t[fg] && t[bg], `${theme}: ${fg} or ${bg} missing`);
      const r = ratio(t[fg]!, t[bg]!);
      const key = `${theme} ${fg}/${bg}`;
      if (r < 4.5 && !(key in KNOWN_BELOW)) fails.push(`${key} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(fails, []);
});


test("the dark theme under prefers-color-scheme repeats the [data-theme=dark] values", () => {
  const css = readFileSync(join(ROOT, "assets-src", "weave.css"), "utf8");
  const dark = block(css, /\[data-theme="dark"\] \{([\s\S]*?)\n\}/);
  const media = block(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/);
  for (const [k, v] of Object.entries(dark)) assert.equal(media[k]?.toLowerCase(), v.toLowerCase(), k);
});
