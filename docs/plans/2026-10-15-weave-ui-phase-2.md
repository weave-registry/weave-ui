# Plan: weave-ui Phase 2 — the templates at parity with weave's core console pages

**Decision:** weave's [ADR-0234](https://git.local/gary/weave/src/branch/main/docs/adrs/ADR-0234-the-console-moves-to-weave-ui-and-weave-serves-a-versioned-api-and-a-pinned-bundle.md)
§1–§4, §6, §7 and §8 Phase 2, with its 2026-10-15 amendment (what weave's Phase 1 loader actually accepts).
**Phase 1 it binds to:** weave `main` at `c4e6e3a7` — `src/domain/console-views.ts` (contract 1.0),
`src/domain/console-api.ts` (route table), `src/domain/html-shape.ts`, `src/ports/console-templates.ts`,
`src/adapters/secondary/console-ui-bundle.ts` (the loader), `docs/api/console-views-v1.d.ts`.

weave-ui is a repository of htmx templates: pure TypeScript functions from a view model (the vendored contract) to an
escaped HTML string, plus static assets. weave loads the built bundle through its `ConsoleTemplates` port, in a
`node:vm` context, under `--console-ui <dir>` until Phase 3 pins and embeds it. Neither repository imports the other's
code.

## What the bundle must be (weave's loader, as built)

| Loader rule (console-ui-bundle.ts) | How weave-ui meets it |
|---|---|
| `templates.js` + `manifest.json` (`version`, `requiresViews` non-empty strings) + `assets/` | `bun run build` writes exactly that into `dist/` |
| `requiresViews` same major as weave's contract, minor not newer | `"1.0"`, read from the vendored contract's `ConsoleApiVersion` |
| scan refuses `import`, `require(`, `process`, `globalThis`, `eval`, `Function(`, `fetch`, `XMLHttpRequest`, `WebSocket`, `Atomics`, `SharedArrayBuffer`, `Promise`, `async`, `await`, `FinalizationRegistry` as whole words — **anywhere in the file, string literals included** | the same scan (a copy) runs over the built file in the tests and in CI; template copy avoids those words |
| a top-level `templates` **data property** on the global, holding functions | the build ends the script with `var templates = …;` (a `var`, so it lands on the context's global) |
| each render: `templates[name](JSON vm, JSON ctx)` must return a string, within 50 ms, ≤ 2 MiB | every template is `(vm, ctx) => string`, synchronous and pure |
| assets ≤ 16 MiB in total, served by exact path at `/ui/assets/<path>` | size budget in CI |
| no host object in the context (no `console`, timers, `structuredClone` is a built-in) | templates use only the language's built-ins |

Templates weave renders by name (from `console-api.ts`): `home`, `work`, `control`, `machines`, `fleet`, `team`,
`task`, `audit`, `factory`, plus `error` (every refusal, `ErrorView`). `POST /ui/a/<verb>` answers the concatenated
fragments of the views its route lists in `refresh`, so every view fragment is self-identifying: its root carries
`id="view-<name>"` and `hx-swap-oob="true"`, and every htmx request in a fragment uses `hx-swap="none"` — a response
lands wherever its views are on the page and is dropped where they are not.

## Phase 2 departures and settlements (to record in weave's ADR when Phase 3 lands)

- **No `hx-*` attribute carries data.** weave's shape test compares an `hx-*` attribute's value up to `?`/`#`, so
  `hx-vals` with an id inside would change shape under the hostile corpus. Action bodies travel as `<input
  type="hidden" name=… value=…>` inside a `<form hx-post="/ui/a/<verb>">`; data reaches `hx-get` only after the `?`.
- **Form bodies are strings.** `formBody` sends every field as a string. Any action whose handler needs a number or
  boolean is listed as a weave PR to make first (coerce in `formBody`), not worked around in markup.
- **Live updates poll until Phase 3.** `/ui/events` (the invalidation stream) is Phase 3's. Each fragment re-fetches
  itself with `hx-trigger="every Ns"`; `app.js` holds a poll while the operator is typing in that fragment.
- **Page shells for the parity check.** The page routes that wrap the layout around the first fragments are Phase 3's.
  For Phase 2 the build writes one static shell per page into `assets/pages/<page>.html` (served by weave at
  `/ui/assets/pages/<page>.html` under the `/ui` CSP), made from the same `layout()` the Phase 3 page template will use.
  Links in fragments use the final URLs (`/`, `/task?id=`, `/audit?…`); on a shell, `app.js` maps them to the shells.

## Files, in order

**PR (a) — scaffold, contract, htmx, `html`, build, CI, loader proof**

1. This plan (commit 1, written directly).
2. Written directly (copies, config, CI): `package.json`, `tsconfig.json`, `.gitignore`, `bun.lock`;
   `contract/console-views-v1.d.ts` + `contract/SOURCE.json` (weave commit, sha256); `vendor/htmx/htmx-2.0.11.min.js`,
   `vendor/htmx/sse-2.2.4.js`, `vendor/htmx/VENDOR.json` (version, npm integrity, sha256); `tokens/` (weave's
   `design-system/{colors_and_type.css,tokens.css,theme.json,brand.json,tools/check-tokens.mjs}`, unchanged);
   `assets-src/weave.css` (weave's `/ui/weave.css`, verbatim) and `assets-src/favicon.svg`; `vendor/weave/html-shape.ts`
   (byte-identical copy) and `vendor/weave/purity.ts` (the loader's `IMPURE_TOKENS` + `impurity()`, copied);
   `.forgejo/workflows/ci.yml`; `README.md`.
3. Failing tests, committed before the code (written directly): `test/html.test.ts` (escaping by context, `safeUrl`,
   the build-time refusals, no raw export), `test/bundle.test.ts` (build output, manifest digests, the purity scan,
   loader emulation in `node:vm` with the loader's options, `error` renders), `test/lint.test.ts` (no `hx-on*`, inline
   `on*`, inline `<script>`/`<style>`/`style=` in templates' output or shells), `test/shape.test.ts` (the hostile
   corpus over every template's fixtures), `test/tokens.test.ts` (check-tokens `--check` and weave.css text-pair
   contrast ≥ 4.5:1 in both themes), `test/size.test.ts` (budget).
4. Source, each through `hexa do run` (evidence = that file's tests + `bun run typecheck`): `src/html.ts` →
   `src/templates/error.ts` + `src/templates/index.ts` → `src/layout.ts` → `scripts/lint.ts` → `scripts/build.ts` →
   `assets-src/app.js`.
5. `scripts/weave-loader-proof.ts` (hexa): loads `dist/` with weave's own `loadConsoleBundle` from a weave checkout
   given on the command line and renders `error`; run locally, output pasted in the PR (CI has no weave checkout, and
   weave-ui imports no weave code).

**PRs (b) — the eight templates, in ADR-0133's order, Home first** (each: parity doc + fixtures + failing tests
written directly, then the template through hexa): `home` (+ `fleet` strip it shares with machines) → `work` →
`control` → `factory` → `machines` (+ `fleet`) → `team` → `task` (+ `src/markdown.ts`) → `audit`.

**PR (c) — parity + design review**: `docs/parity-0.1.0.md` (each page against a live, isolated weave with
`--console-ui dist/`), screenshots, `docs/design-review-0.1.0.md`; `.forgejo/workflows/release.yml` (tag → tarball +
`SHA256SUMS`), prepared, no tag pushed.

## Risks

- **The scan reads string literals.** A label with the word "process" or "await" would make weave refuse the bundle.
  The scan runs over the built file in `node --test`, so a template that says it fails before it ships.
- **A bundler helper that names a refused token.** `bun build` emits helpers for some syntax; the same test catches
  them, and the build targets a modern engine so none are needed.
- **Polling replaces a half-typed form.** `app.js` cancels a fragment's poll while an input inside it has focus or a
  changed value.
- **Version skew with weave.** The contract is vendored at a pinned weave commit; `requiresViews` is derived from it.
- **The vm cap on CI.** Fixtures are small; the loader-emulation test uses the loader's 50 ms render cap.

## Proof

`bun run typecheck`, `bun run test` (node --test), `bun run build`, `bun run check` (purity + lint + tokens + size) —
all in CI on `node:22-bookworm`; the loader proof against weave's `loadConsoleBundle` under Node 22 (podman);
`hexa harden` per PR; parity per page against a live isolated weave; a `design-review` pass recorded in `docs/`.
