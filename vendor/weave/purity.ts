/**
 * weave's template-bundle purity scan, copied — not imported — from weave `main` at c4e6e3a7,
 * src/adapters/secondary/console-ui-bundle.ts lines 46–83 (ADR-0234 §3 rule 4, amended 2026-10-15).
 * The lines below the marker are byte-identical to those lines; test/purity.test.ts holds the token list.
 * weave runs the same scan at load and refuses the bundle on the first hit, so weave-ui runs it first.
 */
// ---- copied from weave below this line ----
export const IMPURE_TOKENS: readonly string[] = [
  "import",
  "require(",
  "process",
  "globalThis",
  "eval",
  "Function(",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "Atomics",
  "SharedArrayBuffer",
  "Promise",
  "async",
  "await",
  "FinalizationRegistry",
];

function tokenPattern(token: string): RegExp {
  if (token.endsWith("(")) return new RegExp(`\\b${token.slice(0, -1)}\\s*\\(`, "g");
  return new RegExp(`\\b${token}\\b`, "g");
}

const IMPURE_PATTERNS: readonly (readonly [string, RegExp])[] = IMPURE_TOKENS.map((t) => [t, tokenPattern(t)] as const);

/** The earliest impure token in `src`, as a whole word, with its 1-based line — or null when pure. */
export function impurity(src: string): { readonly token: string; readonly line: number } | null {
  let best: { token: string; index: number } | null = null;
  for (const [token, pattern] of IMPURE_PATTERNS) {
    pattern.lastIndex = 0;
    const m = pattern.exec(src);
    if (m && (best === null || m.index < best.index)) best = { token, index: m.index };
  }
  if (best === null) return null;
  let line = 1;
  for (let i = 0; i < best.index; i++) if (src.charCodeAt(i) === 10) line++;
  return { token: best.token, line };
}
