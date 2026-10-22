import type { ConsoleApiVersion, NavEntry, RenderCtx } from "../contract/console-views-v1.js";
import { html, toHtml } from "./html.js";
import type { SafeHtml } from "./html.js";

/**
 * The console's page layout (ADR-0234 §1 "Pages"): the document wrapped around a page's first fragments — head, the
 * redesign's sidebar shell (docs/plans/2026-10-23-redesign-spec.md, "The shell": the brand mark, the network chip, the
 * core nav in two groups — Operate and Fleet — each entry with its live `nav-meta` slot, and the sidebar foot), the top
 * bar (breadcrumb and record search), the out-of-band error region, and one placeholder per view that htmx fills on
 * load. Every page but Home also carries the Home feed: a hidden #view-home that loads /ui/f/home once, after which
 * the home fragment polls itself and fills the sidebar's live slots; weave.css keeps it hidden on these pages
 * (docs/plans/2026-10-23-redesign.md, decision 4). Home's out-of-band Machines fragments always have a target: Machines
 * places #host-telemetry above its cards and #model-drift below them, and every other page keeps both in a hidden sink.
 *
 * In Phase 2 the build writes one static shell per core page with it into dist/assets/pages/<page>.html
 * (docs/plans/2026-10-15-weave-ui-phase-2.md, "Page shells"); weave's Phase 3 page routes render the same layout.
 * Markup is built only with the one `html` tag (ADR-0234 §4): same-origin scripts, no inline script or style, and
 * htmx configured by `<meta name="htmx-config">`. Pure and synchronous.
 */

/** The contract this bundle was built against; a different `ctx.api` shows the version-skew banner (ADR-0234 §9). */
const BUILT_FOR: ConsoleApiVersion = "1.2";

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
  /** The view needs a query: without one app.js drops its hx-get, so the slot asks for one instead of loading. */
  readonly queryRequired?: boolean;
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

/** The sidebar's nav groups, in order; a nav key in neither group is appended to the first (Operate). */
const NAV_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["Operate", ["home", "work", "factory", "audit"]],
  ["Fleet", ["machines", "team", "control"]],
];

function navLink(n: NavEntry, page: string): SafeHtml {
  return n.key === page
    ? html`<a href="${n.path}" data-key="${n.key}" aria-current="page"><span class="nav-label">${n.label}</span><span class="nav-meta" id="nav-meta-${n.key}"></span></a>`
    : html`<a href="${n.path}" data-key="${n.key}"><span class="nav-label">${n.label}</span><span class="nav-meta" id="nav-meta-${n.key}"></span></a>`;
}

function navGroups(nav: readonly NavEntry[], page: string): SafeHtml[] {
  const grouped = new Set(NAV_GROUPS.flatMap(([, keys]) => keys));
  const rest = nav.filter((n) => !grouped.has(n.key));
  return NAV_GROUPS.map(([label, keys], i) => {
    const entries = keys.flatMap((k) => nav.filter((n) => n.key === k));
    const all = i === 0 ? [...entries, ...rest] : entries;
    return html`<span class="nav-group">${label}</span>${all.map((n) => navLink(n, page))}`;
  });
}

function viewSlot(v: LayoutView): SafeHtml {
  const required = v.queryRequired === true;
  const note = required
    ? html`<p class="note">Pick a task, an issue or conversation, or a time window — or search for words.</p>`
    : html`<p class="note loading" role="status">Loading…</p>`;
  if (v.fromLocation === true) {
    return required
      ? html`<div id="view-${v.name}" hx-get="/ui/f/${v.name}" hx-trigger="load" hx-swap="none" data-query-from-location data-query-required>${note}</div>`
      : html`<div id="view-${v.name}" hx-get="/ui/f/${v.name}" hx-trigger="load" hx-swap="none" data-query-from-location>${note}</div>`;
  }
  return required
    ? html`<div id="view-${v.name}" hx-get="/ui/f/${v.name}" hx-trigger="load" hx-swap="none" data-query-required>${note}</div>`
    : html`<div id="view-${v.name}" hx-get="/ui/f/${v.name}" hx-trigger="load" hx-swap="none">${note}</div>`;
}

export function layout(o: LayoutOptions): string {
  const { ctx, page } = o;
  const banner =
    ctx.api !== BUILT_FOR
      ? html`<p class="banner" role="status">This console was built for view contract ${BUILT_FOR}; weave serves ${ctx.api}.</p>`
      : "";
  const machines = page.toLowerCase() === "machines";
  const body = machines
    ? html`${o.intro}<div id="host-telemetry" class="telemetry"></div>${o.views.map((v) =>
        v.name === "machines" ? html`${viewSlot(v)}<div id="model-drift"></div>` : viewSlot(v),
      )}`
    : html`${o.intro}${o.views.map(viewSlot)}`;
  const main =
    o.wide ?? WIDE_PAGES.has(page.toLowerCase())
      ? html`<main class="page wide" id="main">${body}</main>`
      : html`<main class="page" id="main">${body}</main>`;
  const sink = machines ? "" : html`<div class="sink" hidden><div id="host-telemetry"></div><div id="model-drift"></div></div>`;
  const feed =
    page.toLowerCase() !== "home"
      ? html`<div id="view-home" hx-get="/ui/f/home" hx-trigger="load" hx-swap="none" hidden></div>`
      : "";
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
<div class="app"><aside class="side" aria-label="Sidebar"><a class="brand" href="/"><span class="mark" aria-hidden="true"></span>weave</a><div class="net" id="side-net"><span class="dot"></span><span class="net-main"><span class="net-name">weave</span><span class="net-sub">…</span></span></div><nav id="nav" class="nav" aria-label="Console">${navGroups(ctx.nav, page)}</nav><div class="side-foot" id="side-foot"></div></aside><div class="frame"><header class="topbar"><div class="crumb"><span>weave</span> <span class="sep">/</span> <b>${o.title}</b></div><form class="search" action="/audit" method="get" role="search"><input type="search" name="find" placeholder="Search tasks, issues, agents…" aria-label="Search the record"></form></header>
${banner}
<div id="weave-error" class="problem" role="alert" hidden></div>
${main}${sink}${feed}</div></div>
</body>
</html>
`;
  return toHtml(doc);
}
