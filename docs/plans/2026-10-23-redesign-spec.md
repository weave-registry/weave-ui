# Redesign spec: markup vocabulary and visual system

Companion to [the plan](2026-10-23-redesign.md). The templates, `src/layout.ts` and `assets-src/weave.css` share this
vocabulary; the mockup's inline styles become these classes. Sizes and colours are from the approved mockup.

## Contents

- Palette (weave.css `:root`)
- Type, spacing, radius
- The shell (`src/layout.ts`)
- Components
- Home (`src/templates/home.ts`)
- Phone
- Icons

## Palette (weave.css `:root`, dark only, `color-scheme: dark`)

| Variable | Value | Use |
|---|---|---|
| `--bg` | #0E1014 | page ground |
| `--side` | #12151A | sidebar, top bar |
| `--surface` | #161A20 | panels, tiles, inputs |
| `--sunken` | #1E232B | active nav item, pressed chip, hover, code |
| `--line` | #262B33 | panel edges, dividers |
| `--line-soft` | #1F242C | row hairlines inside panels |
| `--line-strong` | #3A4250 | outline-button and chip borders |
| `--fg` | #E7E9ED | text |
| `--muted` | #A3AAB6 | secondary text |
| `--faint` | #7D8592 | group labels, ages, counts |
| `--ok` / `--ok-fill` | #7FDCA2 / #5FD08A | healthy: text / dots, bars |
| `--work` / `--work-fill` | #8DBBFF / #6AA8FF | in progress, links: text / dots, bars |
| `--needs` / `--needs-fill` | #F7C46F / #F2A93B | needs you: text / dots, bars, the mark |
| `--needs-bg` / `--needs-line` | #3A2A12 / #4A3818 | needs pill ground / held card edge |
| `--bad` / `--bad-fill` | #FF9A92 / #FF7A70 | broken: text / dots, bars, banner icon |
| `--bad-bg` / `--bad-line` / `--bad-text` | #2A1716 / #5A2A28 / #E3B3AE | banner ground / edge / its second line |
| `--auto` / `--auto-bg` / `--auto-line` | #C9B1FF / #241C36 / #5B4A86 | decided for you |
| `--primary` / `--on-primary` | #E7E9ED / #0E1014 | the primary button (light fill, dark text) |
| `--on-bad` | #1A0B0A | text on `--bad-fill` |
| `--focus` | #8DBBFF | focus ring |

The Phase 2 variable names the not-yet-redesigned page blocks use stay defined (`--line-strong`, `--primary`,
`--on-primary`, `--shadow: none`, `--font`, `--mono`, `--t-sm`…`--t-xl`, `--lh`, `--s1`…`--s7`, `--r-sm`, `--r`,
`--r-pill`, `--w-page`, `--w-wide`), mapped onto this palette.

## Type, spacing, radius

- Body 14px / 1.45, `--font`: `Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; `--mono`:
  `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. Numbers (`.num`) are mono, tabular.
- Panel heading (`h2` in `.panel-head`): 16px / 600. Page `h1`: 22px / 700, letter-spacing -0.01em.
- Uppercase labels (KPI label, tag, nav group): 11–12px, 700, letter-spacing .06–.08em.
- Radius: 12px panels and tiles, 8px buttons, inputs, nav items, chips are pills (999px), 4px state chips.
- Main column: max-width 1384px, padding 24px 28px 48px, sections 20px apart.

## The shell (`src/layout.ts`)

```html
<body hx-ext="weave-json" data-shell="home">
<div class="app">
  <aside class="side" aria-label="Sidebar">
    <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>weave</a>
    <div class="net" id="side-net"><span class="dot"></span><span class="net-main"><span class="net-name">weave</span><span class="net-sub">…</span></span></div>
    <nav id="nav" class="nav" aria-label="Console">
      <span class="nav-group">Operate</span>
      <a href="/" data-key="home" aria-current="page"><span class="nav-label">Home</span><span class="nav-meta" id="nav-meta-home"></span></a>
      … work, factory, audit …
      <span class="nav-group">Fleet</span>
      … machines, team, control …
    </nav>
    <div class="side-foot" id="side-foot"></div>
  </aside>
  <div class="frame">
    <header class="topbar"><div class="crumb"><span>weave</span> <span class="sep">/</span> <b>Home</b></div>
      <form class="search" action="/audit" method="get" role="search"><input type="search" name="find" placeholder="Search tasks, issues, agents…" aria-label="Search the record"></form></header>
    <p class="banner">…version skew, when it applies…</p>
    <div id="weave-error" class="problem" role="alert" hidden></div>
    <main class="page wide" id="main">…view slots…</main>
  </div>
</div>
</body>
```

- `.app`: `display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100vh`.
- `.side`: background `--side`, border-right 1px `--line`, padding 18px 14px, flex column, gap 20px, sticky top 0,
  height 100vh, overflow auto. `.brand`: 17px 700 `--fg`, gap 10px, padding 0 8px; `.mark` is a 22px square painted
  `--needs-fill` through the wave mask (Icons).
- `.net`: padding 9px 10px, radius 8px, border 1px `--line`, background `--surface`; `.net-name` 13px 600,
  `.net-sub` 11px `--muted`.
- `.nav`: flex column, gap 2px. `.nav-group`: 11px 700 uppercase .08em `--faint`, padding 6px 10px (the second group
  14px top). `.nav a`: flex, gap 10px, padding 9px 10px, radius 8px, `--muted`, no underline; `::before` is the 18px
  icon (a mask painted `currentColor`); hover `--fg` on `--sunken`; `[aria-current="page"]`: `--fg`, 600, on
  `--sunken`. `.nav-label` flex 1. `.nav-meta`: 12px `--faint`; inside it `.pill` (amber count) or `.count[data-tone]`
  (coloured text) or a `.dot`.
- `.side-foot`: margin-top auto, border-top 1px `--line`, padding 12px 10px 0, flex column gap 10px, 12px text.
  `.side-row`: flex, gap 8px, align center; `.side-end` margin-left auto, `--muted`. `.side-yolo[data-on="true"]`
  `--needs` 600. `.side-spend` holds a `.side-row` and a `meter.bar` (4px). `.side-halt`: border 1px `--bad-line`,
  radius 8px, padding 8px 10px, `--bad`, 12px; `.side-halt code` `--fg`; `.side-halted` `--bad` 600.
- `.frame`: min-width 0. `.topbar`: flex wrap, gap 10px 16px, padding 10px 28px, min-height 36px, border-bottom 1px
  `--line`, background `--bg`. `.crumb` 13px `--muted`, `b` `--fg` 600, `.sep` `--faint`. `.search` margin-left auto;
  its input 300px max 100%, padding 8px 12px 8px 32px, radius 8px, border 1px `--line`, background `--surface` with
  the search icon (a `::before` mask on the form, or a background mask), 13px.
- `.page`: max-width 1384px, margin 0 auto, padding 24px 28px 48px. `.page.wide` the same.
- Hidden Home feed: `body:not([data-shell="home"]) #view-home { display: none !important; }` (outside the scoped
  page-styles block). `.sink { display: none; }`.

## Components

- `.panel`: background `--surface`, border 1px `--line`, radius 12px. `.panel-head`: flex wrap, align center, gap
  12px, padding 16px 18px, border-bottom 1px `--line`; `h2` 16px 600 margin 0. `.panel-body`: padding 16px 18px, flex
  column gap 12–14px. `.panel-link`: margin-left auto, 13px, `--work`. A panel with no head rows (`.panel > .lrows`)
  is flush.
- `.pill`: padding 2px 8px, radius 999px, 12px 700; `[data-tone="needs"]` `--needs` on `--needs-bg`;
  `ok` `--ok` on a green-tinted ground (color-mix of `--ok-fill` 16% in `--surface`), `work` likewise blue, `bad`
  `--bad` on `--bad-bg`; no tone `--muted` on `--sunken`.
- `.count[data-tone]`: text only, 12px; tones colour it (`ok`, `work`, `needs`, `bad`), none is `--faint`.
- `.chips`: flex wrap gap 6px, margin-left auto. `.chip`: button reset, padding 6px 10px, radius 999px, border 1px
  `--line`, transparent, `--muted`, 12px; `[aria-pressed="true"]` border `--line-strong`, background `--sunken`,
  `--fg`.
- `.dot`: inline-block 8px circle, `--faint`; `[data-tone]` ok / work / needs / bad / auto use the `-fill` colours.
- `.tag`: 11px 700 uppercase .06em, flex 0 0 84px; tones colour the text (`needs`, `bad`, `work`, `ok`, `auto`;
  none `--muted`).
- `.btn`: inline-flex, gap 6px, padding 8px 12px, radius 8px, border 1px `--line-strong`, transparent, `--fg`, 13px
  500, min-height 34px; hover `--sunken`. `.btn.primary`: `--primary` fill, `--on-primary` text, no border, 600.
  `.btn.danger`: `--bad`, border `--bad-line`; hover `--bad-fill` fill, `--on-bad` text. `.btn.link`: no border,
  `--work`. `.btn.sm`: padding 6px 10px, 12px, min-height 28px. Disabled .55 opacity. Coarse pointer: min-height 44px.
- `.kpis`: grid, `repeat(auto-fit, minmax(200px, 1fr))`, gap 12px. `.kpi` (an `a`): flex column gap 6px, padding 16px
  18px, radius 12px, `--surface`, border 1px `--line`, `--fg`, no underline; hover border `--line-strong`.
  `.kpi-label` 12px 600 uppercase .06em `--muted`; `.kpi-value` 32px 700 -0.02em, `.num`; `.kpi-sub` 12px `--muted`.
  `.kpi[data-tone]` colours `.kpi-value`: needs `--needs`, work `--work`, ok `--ok`, bad `--bad`.
- `.lrows`: list, no margin. `.lrow`: flex wrap, align center, gap 10px 16px, padding 14px 18px, border-bottom 1px
  `--line-soft`; last none. `.lrow[hidden]` display none. `.lrow-main` flex 1 1 360px, min-width 0. `.lrow-title`
  600, one line with ellipsis (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`); a link inside it
  is `--fg`. `.lrow-why` 13px `--muted`, one line with ellipsis. `.lrow-meta` 12px `--faint`, nowrap. `.lrow-acts`
  flex wrap gap 8px, margin-left auto; forms inside are inline. `.lrow-code` mono 12px `--muted`, one line,
  ellipsis, block. `.lrow-more` (a `details`) flex-basis 100%, 12px `--muted`; its `pre` as `pre`. `.lrow .who`
  12px 600 (`[data-tone="auto"]` `--auto`, `needs` `--needs`).
- `meter.bar`: appearance none, block, width 100%, height 6px, radius 3px, background `--line`; the value
  (`::-webkit-meter-bar`, `::-webkit-meter-optimum-value` / `suboptimum` / `even-less-good`, `::-moz-meter-bar`)
  `--ok-fill`; `[data-tone="work"]` `--work-fill`, `needs` `--needs-fill`, `bad` `--bad-fill`.
- `.health`: flex wrap, align center, gap 12px 20px, padding 14px 18px, radius 12px, border 1px.
  `[data-verdict="halted"]` and `degraded`: ground `--bad-bg`, border `--bad-line`, `.health-icon` `--bad-fill`;
  `working`: blue-tinted ground (color-mix `--work-fill` 12% in `--surface`), border `--line`; `idle`: `--surface`,
  border `--line`. `.health-icon` 20px warn mask. `.health-main` flex 1 1 420px. `.health-title` 600; `.health-word`
  as is. `.health-sub` 13px `--bad-text` (on halted/degraded), else `--muted`. `.health-more` list none, margin 8px
  0 0, gap 6px; `.health-reason` flex wrap gap 8px, 13px. `.health-act` flex gap 8px.
- `.empty`: `--muted`, padding 16px 18px.
- Old classes restyled (any page): `.card` = panel look (radius 12px, `--surface`, border `--line`, padding 14px
  16px); `.card.needs` border-left 3px `--needs-fill`; `.card.bad` `--bad-bg` / `--bad-line`; `.card-title` 15px 600;
  `.card-why` 13px `--muted`. `.section` (h2 between blocks): 12px 700 uppercase .06em `--muted`. `.badge` = a pill
  (`data-tone` as `.pill`, `auto` on `--auto-bg`). `.status` with a coloured dot. `.row` hairlines `--line-soft`.
  `.table` / `.table-wrap`: border `--line`, header `--muted` 12px uppercase on `--side`, cells 10px 14px, hairlines
  `--line-soft`. `pre`, `code`: mono, `--sunken` ground, border `--line`. Inputs/selects/textareas: `--surface`,
  border `--line`, radius 8px, `--fg`. `.problem`: `--bad-bg`, border `--bad-line`, `--bad-text`. `.page-head h1`
  22px 700.

## Home (`src/templates/home.ts`)

Scoped under `.view.home` (inside the page-styles block):

- `.view.home`: flex column, gap 20px.
- `.home-grid`: flex wrap, gap 20px, align start; the needs panel `flex: 999 1 640px; min-width: 0`; `.home-side`
  `flex: 1 1 360px; min-width: 0`, flex column gap 20px.
- `.host`: flex column gap 6px; `.host-head` flex baseline gap 8px; `.host-name` 600; `.host-meta` margin-left auto,
  mono 12px `--muted`. `.hbar`: flex align center gap 8px, 12px `--muted`; `.hbar-label` width 44px; the meter flex
  1; `.hbar-val` width 40px right, mono.
- `.switch-row`: flex align center gap 10px; `.switch-name` 500; `.switch-sub` 12px `--muted`. The yolo control's
  button is a 44×26 switch when on (`.switch`, `aria-pressed`), `--needs-fill` track when pressed.
- `.facts`: list none, flex column gap 6px, 13px `--muted`.
- `.home-lower`: grid, `minmax(0, 1fr) 420px`, gap 20px, align start; `.home-col` flex column gap 20px. Under 1000px
  one column.
- `.chat` (Ask weave) is a `.panel`: flex column, height 70vh (min 420px), sticky top 16px; `.chat-head`,
  `.chat-log`, `.turn`, `.turn.you`, `.turn.weave`, `.composer` as in Phase 2, retoned. Under 1000px static, auto
  height, max-height 80vh.

## Phone

`@media (max-width: 760px)`: `.app { display: block }`; `.side` static, height auto, border-bottom instead of right,
padding 12px; the nav becomes a wrapping row (`flex-direction: row; flex-wrap: wrap`), group labels hidden, items
padding 7px 10px; `.side-foot` a row that wraps, margin-top 0. `.topbar` and `.page` padding 12px 16px. `.search`
full width. The KPI strip two columns. No nav item is hidden.

## Icons

Masks, painted `currentColor` (or `--needs-fill` for the mark, `--bad-fill` for the banner's warn icon), 24×24
stroke icons from the mockup, `data:image/svg+xml` URLs with `<`, `>` and `#` percent-encoded and single quotes
inside (so the URL sits in double quotes and holds no `{`, `}` or `;`):

```
home:     url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'/%3E%3C/svg%3E")
work:     url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='5' height='16' rx='1'/%3E%3Crect x='10' y='4' width='5' height='10' rx='1'/%3E%3Crect x='17' y='4' width='4' height='13' rx='1'/%3E%3C/svg%3E")
factory:  url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 21V10l6 4V10l6 4V6l6 4v11z'/%3E%3C/svg%3E")
audit:    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5M8 11h6M11 8v6'/%3E%3C/svg%3E")
machines: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='6' rx='1'/%3E%3Crect x='3' y='14' width='18' height='6' rx='1'/%3E%3Cpath d='M7 7h.01M7 17h.01'/%3E%3C/svg%3E")
team:     url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='9' cy='8' r='3.5'/%3E%3Cpath d='M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5'/%3E%3C/svg%3E")
control:  url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12'/%3E%3Ccircle cx='16' cy='6' r='2'/%3E%3Ccircle cx='10' cy='12' r='2'/%3E%3Ccircle cx='18' cy='18' r='2'/%3E%3C/svg%3E")
mark:     url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7c3 0 3 10 6 10s3-10 6-10 3 10 6 10'/%3E%3C/svg%3E")
warn:     url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'/%3E%3C/svg%3E")
search:   url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E")
```

Each nav icon rule names its key directly and writes its URL once, unprefixed (current Chromium, Firefox and Safari
support `mask-image`; a prefixed copy would double the bytes): `.nav a[data-key="home"]::before { mask-image:
url("data:…"); }`. The shared `.nav a::before` rule sets `content: ""`, 18×18, `flex: none`, `background:
currentColor`, `mask-size: contain`, `mask-repeat: no-repeat`, `mask-position: center`.

## Work (`src/templates/work.ts`, PR 2)

- Head: `h1` and a `.stats` row of `<span><b>N</b> label</span>` (in progress, queued, merged today in `--ok`, slots busy).
- `.board` (a panel, horizontal scroll): `.board-cols` is a 7-column grid (`minmax(180px, 1fr)`, min-width 1260px);
  `.col[data-step]` (border-right `--line-soft`, padding 14px 12px, min-height 320px) with `.col-head` (`.col-name`
  12px 700 uppercase `--muted`, `.col-count` mono `--faint`). `.wcard[data-state]`: `--surface`, radius 10px, padding
  12px, flex column gap 8px, border 1px — held `--bad-line`, waiting `--needs-line`, running `--line-strong`, queued
  `--line`. `.wcard-top` (`.wcard-id` mono `--muted`, `.state[data-state]` 11px 700 radius 4px chip: held `--bad` on
  `--bad-bg`, waiting `--needs` on `--needs-bg`, running blue-tinted, queued `--muted` on `--sunken`), `.wcard-title`
  13px 600, `.wcard-note` 12px `--muted`, `.wcard-foot` 12px `--faint` with `.wcard-age` pushed right.
- Below: `.work-lower` (flex wrap, gap 20px): Where you can help (`#help`, list rows), Who is working (`#who`: per
  machine a `.slot-host` with `.slot-head` and a `.slots` strip of `.slot` cells — 22px tall, radius 4px, `--line`;
  `[data-busy="true"]` `--work-fill` — then `.slot-doing` lines linking each task), Other work (`#other`).

## Machines (`src/templates/machines.ts` and Home's fragments, PR 2)

- Head: `h1` and a `.sub` line (`<b data-tone>` connected count, agents, versions).
- `#host-telemetry.telemetry` (above the cards, filled from Home's model): a grid of `.tele` panels — `.tele-head`
  (dot, name, `.tele-spec`), `.tele-stats` three `.stat` cells (`.stat-label` 11px uppercase `--muted`, `.stat-value`
  22px 700 with tones, `.stat-sub` 12px `--faint`): Load, Memory, Slots.
- `.hosts`: grid `repeat(auto-fit, minmax(380px, 1fr))`, gap 16px, of `.host-card` panels: head with dot, `h2`, and
  `.host-heard` pushed right; `.host-remedy`; agent list rows with Pause / Resume.
- `#model-drift` (below the cards, from Home's model): a panel with a `.table` — setting in mono, one column per
  gateway, the source muted.
