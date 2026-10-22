# Plan: weave-ui runs as its own server against weave's /api/v1 (#8, weave ADR-0245 P2)

No PLAN.md existed when the build stage began (the plan stage left no artifact), so the build stage wrote this one from the
issue text and the code. #8 is several PRs ("small PRs based on main; stop at green CI"). **This build is PR 1 of P2:
the server's configuration and the browser-side protections**, each pure and testable without a running weave.
The rest is listed so the next stages and PRs know where this stops.

## Files that change (PR 1)
- `test/server/trust.test.ts`, `test/server/config.test.ts`, `test/server/security.test.ts` — new, written first (red).
- `src/server/trust.ts` — new: `parseCidr`, `isTrusted` (the `--trust-cidr` rule; IPv4, IPv6, v4-mapped).
- `src/server/config.ts` — new: `loadConfig(env, argv)` → `{ weaveUrl, secret, host, port, trustCidrs }`; `ConfigError`.
  WEAVE_URL (http/https, any host, no userinfo/query/fragment), WEAVE_CONSOLE_SECRET (env only — the module imports no
  file API), WEAVE_UI_PORT (default 8790), WEAVE_UI_HOST (default 127.0.0.1), `--trust-cidr` / WEAVE_UI_TRUST_CIDR.
- `src/server/security.ts` — new: `securityHeaders()` (CSP + nosniff, no-referrer, DENY, no-store), `csrfToken`,
  `checkCsrf` (token header + Origin / Sec-Fetch-Site).

Nothing under `src/templates/`, `src/ui/`, `contract/` or `dist/` changes in PR 1, so the bundle weave loads today
is byte-identical.

## Order of work (build steps: file — instruction — evidence)
1. `src/server/trust.ts` — implement parseCidr/isTrusted — `node --import tsx --test test/server/trust.test.ts`
2. `src/server/config.ts` — implement loadConfig/ConfigError (uses trust.ts) — `node --import tsx --test test/server/config.test.ts`
3. `src/server/security.ts` — implement securityHeaders/csrfToken/checkCsrf — `node --import tsx --test test/server/security.test.ts`
4. Gate, once: `npm run typecheck && node --import tsx --test test/*.test.ts test/server/*.test.ts` (and `bun run test` in CI).

## Later PRs of P2 (not in this build)
- **PR 2 — the weave client** (`src/server/weave-client.ts`): credential as a header only; over TLS, check
  `x-weave-cert-hmac` on `/health` before the first credentialed request (ADR-0064); `/api/v1/bar`; `x-refresh` read
  from the OpenAPI document; `GET /api/v1/file?path=&task=` returning text or base64.
- **PR 3 — the changes fan-out**: one subscription to `/api/v1/changes` (view names, Last-Event-ID resume), fanned out to
  browsers over SSE.
- **PR 4 — the HTTP server and pages**: `src/server/main.ts` (Bun/Node, own port), routes rendering the existing
  templates, login + passkeys, `/file` route (the `/file?path=` links in `home.ts:548` and `task.ts:95` gain `&task=`
  where a task is in scope), `weave halt` / `weave resume` shown as text, the systemd user unit
  (`weave secret exec -- …` supplies WEAVE_CONSOLE_SECRET).
- **PR 5 — contract v1.2**: re-vendor `contract/console-views-v1.d.ts` from weave main; update `contract/SOURCE.json`
  and `vendor/SHA256SUMS`. Needs weave's main checkout — the build sandbox has none and no network path to it.

## Risks
- **Header name and HMAC recipe are weave's to define.** The credential header and the `x-weave-cert-hmac` computation
  are not in this repository; PR 2 must take them from weave's `docs/api` / ADR-0064, not from a guess. PR 1 avoids them.
- **Trust-by-address is dangerous behind a proxy.** `isTrusted` takes the socket peer address; PR 4 must never feed it
  `x-forwarded-for`. Default is no trusted networks.
- **CSRF on htmx.** htmx requests need the token; PR 4 adds it via a `<meta>` read by `app.js` on `htmx:configRequest`
  (no `hx-headers`/inline script — the CSP and the shape test forbid it).
- **Bundle purity.** `src/server/**` must stay out of the templates entry (`src/templates/index.ts`); the purity scan
  refuses `process`, `fetch`, etc. in `dist/templates.js`. Not searched: whether `scripts/lint.ts` globs `src/**`.
- **`bun` is not on the sandbox PATH**, so per-step evidence uses `node --import tsx --test`, not `bun run test`.

## Proof
Per-step tests above; `tsc -p tsconfig.json --noEmit`; the whole `test/*.test.ts` suite (existing tests unchanged and
green); CI's `typecheck · tests · purity · lint` and `tokens · build · size budget` on the PR.

## Loop
`hexa_loop` adr: no ADR exists in this repository (`docs/adrs/` is empty; the decision is weave's ADR-0245).
gate: `npm run typecheck && node --import tsx --test test/server/*.test.ts`
evidence: `node --import tsx --test test/*.test.ts test/server/*.test.ts`

## Progress and slice changes (2026-10-22)
- **PR 1 merged** (weave-ui #9): the three modules above, plus `package.json`'s `test` script now globs
  `test/server/*.test.ts` (it did not, so the server tests never ran in CI); `test/scripts.test.ts` holds every test
  directory to the glob.
- **The contract re-vendor moves from PR 5 into PR 2**, the first slice that needs it (`BarView`, `FileView`). Copied
  byte-for-byte from weave `docs/api/console-views-v1.d.ts` (identical at tag v0.2.184 and forge/main 772ef233; last
  changed at 2518f6e0). `layout.ts`'s `BUILT_FOR`, the test context and the bundle test's pin move to 1.2.
  `scripts/weave-loader-proof.ts` still passes `api: "1.0"`: it proves ADR-0234's `node:vm` loader, which ADR-0245
  retires, so it is left alone.
- **PR 2 — the weave client** (`src/server/weave-client.ts`, stub weave in `test/server/stub-weave.ts`). Channel
  binding: `/health` is read with no credential on a fresh connection; `x-weave-cert-hmac` must equal
  HMAC-SHA256(secret, sha256(observed DER)); every credentialed request is then pinned to that certificate (`ca` = the
  certificate, `checkServerIdentity` = its fingerprint), so a changed certificate fails the handshake before any byte of
  the request is sent, and is re-verified once through `/health`. Plain `http:` only to loopback unless
  `insecureUpstream`. Header names from weave `sse-surface.ts`: `X-Weave-Secret`, `X-Weave-On-Behalf-Of`.
- **PR 5 is now the systemd user unit** (template + docs, the secret via `weave secret exec`), since the contract moved
  into PR 2. PR 3 (changes fan-out) and PR 4 (HTTP server and pages) are unchanged.
- **PR 2 merged** (#10), **PR 3 merged** (#11): `src/server/changes.ts` — one upstream `/api/v1/changes`
  subscription, fanned out; a refused resume broadcasts `event: all`.
- **PR 4 is split in two** (it was the server *and* every browser-side change): **PR 4 — the pages, ready for an own
  server**: the fleet verb renders as `weave halt` / `weave resume` text in `actionForm` (one choke point, so every page
  and attention card follows; ADR-0245 §3); file links carry `&task=` (home turns, task page); `app.js` sends
  `X-CSRF-Token` from weave-ui's `wui_csrf` cookie on every write (double-submit, so the static shells need no
  per-session markup) and rewrites links to `/ui/assets/pages/*` only on a static shell. **PR 5 — the HTTP server**
  (`src/server/app.ts` + `main.ts`): pages, `/ui/f`, `/ui/a`, `/ui/assets`, `/events`, `/file`, `/health`, sessions and
  address trust. **PR 6 — the systemd user unit.**
- **Login in P2 is address trust only** (loopback + `--trust-cidr`, with ADR-0220's Host and Sec-Fetch-Site rules);
  a request from anywhere else gets a page saying how to admit it. Accounts and passkeys move at P4 (ADR-0245 §5,
  "Until P4 weave's accounts and login stay as they are"). Recorded as an open question for the operator.
