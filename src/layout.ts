import type { ConsoleApiVersion, NavEntry, RenderCtx } from "../contract/console-views-v1.js";
import { html, toHtml } from "./html.js";
import type { SafeHtml } from "./html.js";

/**
 * The console's page layout (ADR-0234 §1 "Pages"): the document wrapped around a page's first fragments — head,
 * top bar with the core nav, the out-of-band error region, and one placeholder per view that htmx fills on load.
 *
 * In Phase 2 the build writes one static shell per core page with it into dist/assets/pages/<page>.html
 * (docs/plans/2026-10-15-weave-ui-phase-2.md, "Page shells"); weave's Phase 3 page routes render the same layout.
 * Markup is built only with the one `html` tag (ADR-0234 §4): same-origin scripts, no inline script or style, and
 * htmx configured by `<meta name="htmx-config">`. Pure and synchronous.
 */

/** The contract this bundle was built against; a different `ctx.api` shows the version-skew banner (ADR-0234 §9). */
const BUILT_FOR: ConsoleApiVersion = "1.0";

/** htmx configuration. 4xx/5xx responses swap so weave's error fragment (#weave-error, out of band) is shown. */
export const HTMX_CONFIG = {
  allowEval: false,
  allowScriptTags: false,
  selfRequestsOnly: true,
  includeIndicatorStyles: false,
  historyCacheSize: 0,
  refreshOnHistoryMiss: true,
  responseHandling: [
    { code: "204", swap: false },
    { code: "[23]..", swap: true },
    { code: "[45]..", swap: true, error: true },
    { code: "...", swap: true },
  ],
} as const;

export interface LayoutView {
  readonly name: string;
  readonly fromLocation?: boolean;
  readonly poll?: boolean;
}

export interface LayoutOptions {
  readonly page: string;
  readonly title: string;
  readonly ctx: RenderCtx;
  readonly views: readonly LayoutView[];
  readonly htmxFile: string;
  readonly intro?: SafeHtml;
  /** `<main class="page wide">`; defaults from the page key (weave's wide pages are home, work, control and audit). */
  readonly wide?: boolean;
}

/** The pages weave renders full width; the rest use the narrower `.page` column. */
const WIDE_PAGES: ReadonlySet<string> = new Set(["home", "work", "control", "audit"]);

function navLink(n: NavEntry, page: string): SafeHtml {
  return n.key === page
    ? html`<a href="${n.path}" data-key="${n.key}" aria-current="page">${n.label}</a>`
    : html`<a href="${n.path}" data-key="${n.key}">${n.label}</a>`;
}

function viewSlot(v: LayoutView): SafeHtml {
  const loading = html`<p class="note loading" role="status">Loading…</p>`;
  return v.fromLocation === true
    ? html`<div id="view-${v.name}" hx-get="/ui/f/${v.name}" hx-trigger="load" hx-swap="none" data-query-from-location>${loading}</div>`
    : html`<div id="view-${v.name}" hx-get="/ui/f/${v.name}" hx-trigger="load" hx-swap="none">${loading}</div>`;
}

export function layout(o: LayoutOptions): string {
  const { ctx, page } = o;
  const banner =
    ctx.api !== BUILT_FOR
      ? html`<p class="banner" role="status">This console was built for view contract ${BUILT_FOR}; weave serves ${ctx.api}.</p>`
      : "";
  const main =
    o.wide ?? WIDE_PAGES.has(page.toLowerCase())
      ? html`<main class="page wide" id="main">${o.intro}${o.views.map(viewSlot)}</main>`
      : html`<main class="page" id="main">${o.intro}${o.views.map(viewSlot)}</main>`;
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="htmx-config" content='${JSON.stringify(HTMX_CONFIG)}'>
<title>${o.title} · weave</title>
<link rel="stylesheet" href="/ui/assets/weave.css">
<link rel="icon" href="/ui/assets/favicon.svg" type="image/svg+xml">
<script src="${`/ui/assets/${o.htmxFile}`}" defer></script>
<script src="${"/ui/assets/app.js"}" defer></script>
</head>
<body hx-ext="weave-json" data-shell="${page.toLowerCase()}">
<header class="topbar"><div class="topbar-in"><a class="brand" href="/"><img src="/ui/assets/favicon.svg" alt="" width="20" height="20"> weave</a><nav id="nav" class="nav" aria-label="Console">${ctx.nav.map((n) => navLink(n, page))}</nav></div></header>
${banner}
<div id="weave-error" class="problem" role="alert" hidden></div>
${main}
</body>
</html>
`;
  return toHtml(doc);
}
