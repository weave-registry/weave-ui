# weave-ui

The markup of [weave](https://git.local/gary/weave)'s console: htmx templates that weave runs to draw its pages
(weave's ADR-0234). Every template is a pure TypeScript function from a **view model** — a type in weave's versioned
view contract — to an escaped HTML string. weave produces the view model from its log, renders it through these
templates inside a `node:vm` context, and serves the result to the operator's browser. weave owns the data and the
authority; weave-ui owns every byte of markup.

**Runtime dependency: htmx, and nothing else.** htmx 2.0.11 is vendored in `vendor/htmx/` with its sha256 and npm
integrity (`vendor/htmx/VENDOR.json`) and served by weave from the bundle as `/ui/assets/htmx-2.0.11.min.js`. Its SSE
extension sits beside it for the live stream weave adds later. Nothing loads from a CDN. Everything else in
`package.json` is a build or test tool.

## How the two repositories meet

- **The contract.** `contract/console-views-v1.d.ts` is weave's generated declaration file, vendored at a pinned weave
  commit (`contract/SOURCE.json`, sha256 in `vendor/SHA256SUMS`). Every template typechecks against it. weave-ui
  imports no weave code, and weave imports none of this repository's.
- **The bundle.** `bun run build` writes `dist/`: `templates.js` (one script, no imports, ending in
  `var templates = {…}`), `assets/` (htmx, `weave.css`, `app.js`, the favicon, the Phase 2 page shells) and
  `manifest.json` (`version`, `requiresViews`, the htmx version, and every file's sha256). weave loads that directory
  with `weave dev --console-ui dist/` today. Later it will pin a release tarball by sha256 and embed it.
- **Contract changes come from weave first.** A template that needs a new field waits for weave to add it, then
  re-vendors the contract. Then weave moves its pin.

## The rules the templates live by

- **One `html` tagged template, no escape hatch** (`src/html.ts`). Every interpolated value is escaped for where it
  lands: text, a quoted attribute, or a URL (`safeUrl`: same-origin paths and `http(s):` only). Some interpolations
  are refused when the template is built: into an unquoted attribute, an attribute name, `<script>`/`<style>`, or any
  `on*` / `hx-on*` attribute. There is no `raw()`.
- **Pure.** No I/O, no async, no host objects. weave scans `templates.js` before it runs it and refuses the bundle on
  any of `import`, `require(`, `process`, `globalThis`, `eval`, `Function(`, `fetch`, `XMLHttpRequest`, `WebSocket`,
  `Atomics`, `SharedArrayBuffer`, `Promise`, `async`, `await`, `FinalizationRegistry`. The scan covers string
  literals too, so these words cannot appear even in page copy. The tests run the same scan (`vendor/weave/purity.ts`).
- **CSP-clean.** weave serves every page under `script-src 'self'; style-src 'self'` with no `unsafe-inline` and no
  `unsafe-eval`. So the templates use no inline scripts, no `on*` handlers, no `hx-on*` and no `style=` attributes.
  htmx runs with `allowEval: false`, `allowScriptTags: false`, `selfRequestsOnly: true`,
  `includeIndicatorStyles: false` and `historyCacheSize: 0`. The behaviour that needs script lives in
  `assets-src/app.js`, bound by `data-` attributes.
- **Escaping is tested by shape.** `test/shape.test.ts` renders every template against a hostile corpus. Each string
  in a fixture is set in turn to `<script>`, an attribute breakout, a `javascript:` URL, an injected `hx-get`, a
  template probe, a `</textarea>` escape and a 10 000-character string. The tags, attribute names and `hx-*` targets
  must stay identical to a benign render. weave runs the same test over the bundle it pins.

## Commands

| What | Command |
|---|---|
| Install | `bun install --frozen-lockfile` |
| Typecheck | `bun run typecheck` |
| Build `dist/` | `bun run build` |
| Tests (build first, then `node --test`) | `bun run test` |
| Design tokens: drift + contrast | `bun run check:tokens` |
| Prove weave's own loader accepts `dist/` | `node --import tsx scripts/weave-loader-proof.ts <weave checkout>` |

CI (`.forgejo/workflows/ci.yml`, `node:22-bookworm`) runs the typecheck, the tests (templates, shape, purity,
handler lint, loader emulation), the vendored digests, the token check, the build and the size budget.

## Layout

```
contract/        weave's view contract, vendored (+ SOURCE.json)
vendor/htmx/     htmx + its SSE extension, vendored (+ VENDOR.json, licences)
vendor/weave/    weave's shape tokenizer and purity scan, copied
tokens/          the design tokens moved from weave's design-system/, with check-tokens.mjs
assets-src/      weave.css, app.js, favicon.svg
src/html.ts      the html tag, SafeHtml, safeUrl
src/templates/   one file per view, plus error; index.ts maps template names to functions
scripts/         build, lint, the weave loader proof
docs/            plans, parity checklists, design reviews
```

## Licence

MIT, the same as weave (`LICENSE`). htmx and its SSE extension are 0BSD (`vendor/htmx/LICENSE-*`).
