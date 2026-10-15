#!/usr/bin/env node
/**
 * Token export + drift guard for the weave / Touchstone design system.
 *
 *   node tools/check-tokens.mjs           # regenerate brand.json + theme.json
 *   node tools/check-tokens.mjs --check   # verify they match the CSS; exit 1 on drift
 *
 * colors_and_type.css and tokens.css are the ONE source of truth. The JSON
 * exports are derived, never hand-edited — that is the whole point of this
 * script. Run --check in CI before publishing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ── parse every custom property out of a stylesheet's :root blocks ────── */
function parseTokens(css) {
  const out = {};
  for (const block of css.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
    for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out[m[1]] = m[2].trim().replace(/\s+/g, ' ');
    }
  }
  return out;
}

const colorCss = read('colors_and_type.css');
const tokenCss = read('tokens.css');
const T = { ...parseTokens(colorCss), ...parseTokens(tokenCss) };

const pick = (...names) => Object.fromEntries(
  names.filter((n) => n in T).map((n) => [n.replace(/^--/, ''), T[n]])
);

/* ── contrast, computed rather than asserted ───────────────────────────── */
const srgbToLinear = (c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = toRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};

/* Every token that is ever painted AS TEXT, against every token it is ever
   painted ON. --surface-warm backs panel headers, toasts and hover rows, so it
   is a real text background; omitting it hid the tightest pair in the system.
   The status hues are text too — .ok / .warn-t / .bad / .hot in colors_and_type. */
const TEXT = ['--fg', '--fg-2', '--muted', '--meta', '--success', '--warn', '--danger', '--auto', '--accent'];
const BACKDROP = [['onBg', '--bg'], ['onSurface', '--surface'], ['onSurfaceWarm', '--surface-warm']];

const contrast = Object.fromEntries(TEXT.map((t) => [
  t.replace(/^--/, ''),
  Object.fromEntries(BACKDROP.map(([label, bg]) => [label, ratio(T[t], T[bg])])),
]));

/* The one inverted pair: dark ink on a filled accent control (.btn-primary). */
contrast['accent-on'] = { onAccent: ratio(T['--accent-on'], T['--accent']) };

/* ── theme.json — the full resolved token set ──────────────────────────── */
const theme = {
  $schema: 'https://design-tokens.org/schema.json',
  id: 'user:touchstone-design-system-2',
  name: 'weave / Touchstone',
  lineage: 'Agentic',
  colorScheme: 'dark only',
  generatedFrom: ['colors_and_type.css', 'tokens.css'],
  note: 'Derived file. Edit the CSS, then run: node tools/check-tokens.mjs',
  color: {
    surface: pick('--bg', '--surface', '--surface-warm'),
    text: pick('--fg', '--fg-2', '--muted', '--meta'),
    line: pick('--border', '--border-soft'),
    accent: pick('--accent', '--accent-on', '--accent-hover', '--accent-active'),
    status: pick('--success', '--warn', '--danger', '--auto'),
    derived: pick('--claimed', '--accent-soft', '--accent-line', '--fg-soft', '--auto-bg', '--auto-line'),
  },
  contrast,
  font: pick('--font-display', '--font-body', '--font-mono'),
  fontSize: pick('--text-2xs', '--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl', '--text-4xl'),
  lineHeight: pick('--leading-body', '--leading-tight'),
  letterSpacing: pick('--tracking-display'),
  space: pick('--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-12'),
  sectionRhythm: pick('--section-y-desktop', '--section-y-tablet', '--section-y-phone'),
  radius: pick('--radius-sm', '--radius-md', '--radius-lg', '--radius-pill'),
  elevation: pick('--elev-flat', '--elev-ring', '--elev-raised', '--focus-ring'),
  glow: pick('--glow', '--glow-hot', '--glow-danger'),
  motion: pick('--motion-fast', '--motion-base', '--ease-standard'),
  layout: pick('--container-max', '--container-gutter-desktop', '--container-gutter-tablet', '--container-gutter-phone', '--topbar-h'),
  breakpoints: {
    note: 'The class system ships TWO breakpoints. 1100px exists only inside index.html.',
    railCollapse: '1280px',
    shellRelease: '920px',
  },
};

/* ── brand.json — identity, not the token dump ─────────────────────────── */
const brand = {
  id: 'user:touchstone-design-system-2',
  name: 'weave',
  wordmark: 'weave',
  wordmarkCase: 'always lowercase',
  title: 'weave / Touchstone',
  lineage: 'Agentic',
  description:
    'Dark operations HUD for a cooperative-agent harness. Makes distributed state legible in real time and stops cold at irreversible effects.',
  source: {
    project: 'Touchstone',
    projectId: '8e5b32ea-c44c-4efd-b0aa-53f74112dc6c',
    importedFrom: '/Volumes/SSD/Development/weave',
    evidence: 'context/provenance.md',
  },
  colorScheme: 'dark only',
  lightThemeSupported: false,
  core: {
    background: T['--bg'],
    surface: T['--surface'],
    foreground: T['--fg'],
    muted: T['--muted'],
    border: T['--border'],
    accent: T['--accent'],
    accentOn: T['--accent-on'],
  },
  status: { success: T['--success'], warn: T['--warn'], danger: T['--danger'], auto: T['--auto'], claimed: T['--claimed'] },
  typography: {
    display: T['--font-display'],
    body: T['--font-body'],
    mono: T['--font-mono'],
    webfonts: 'Inter 400/500/600/700 + JetBrains Mono 400/500/600 (Google Fonts; no font files ship)',
    rule: 'Inter for what a human wrote, mono for what a machine produced.',
  },
  assets: {
    mark: 'assets/brand/weave-mark.svg',
    markAccent: 'assets/brand/weave-mark-accent.svg',
    lockup: 'assets/brand/weave-lockup.svg',
    appIcon: 'build/icon.svg',
    favicon: 'build/favicon.svg',
    screenshot: 'assets/screens/cold-start.png',
  },
  assetRules: [
    'currentColor does not cross an <img>: inline weave-mark.svg, or use weave-mark-accent.svg.',
    'No double hyphen inside an SVG comment — strict XML parse, silent failure.',
  ],
  voice: {
    register: 'Terse, technically precise, quietly confident. Written for an operator who already knows what a lease is.',
    rules: [
      'Lowercase product name, always.',
      'Sentence case headings; uppercase only in the mono register.',
      'Lead with the state, then the caveat.',
      'Numbers are specific or absent.',
    ],
  },
  entrypoints: {
    rules: 'DESIGN.md',
    agentUsage: 'SKILL.md',
    css: 'variables.css',
    tokens: 'theme.json',
    review: 'preview/index.html',
    appliedKit: 'ui_kits/app/index.html',
  },
};

/* ── write or check ────────────────────────────────────────────────────── */
const targets = [['brand.json', brand], ['theme.json', theme]];
const checking = process.argv.includes('--check');
let drift = 0;

for (const [file, data] of targets) {
  const next = JSON.stringify(data, null, 2) + '\n';
  if (!checking) {
    writeFileSync(join(ROOT, file), next);
    console.log(`wrote ${file}`);
    continue;
  }
  let current = '';
  try { current = read(file); } catch { /* missing counts as drift */ }
  if (current !== next) {
    console.error(`DRIFT: ${file} does not match the CSS. Run: node tools/check-tokens.mjs`);
    drift++;
  } else {
    console.log(`ok    ${file}`);
  }
}

if (checking) {
  const floor = 4.5;
  for (const [name, pairs] of Object.entries(contrast)) {
    for (const [where, value] of Object.entries(pairs)) {
      if (value >= floor) continue;
      console.error(`CONTRAST: --${name} is ${value}:1 ${where}, under ${floor}:1`);
      drift++;
    }
  }
  process.exit(drift ? 1 : 0);
}
