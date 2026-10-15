<!-- Read from weave main at c4e6e3a7 (the page adapters this repo replaces). File paths below are weave's. This is the parity checklist the templates are built and checked against. -->

# Parity spec: Factory, Machines, Team (weave console, read from source)

Things that differ from what you expected:
- **Factory**'s per-issue Start button posts `{factoryAdvance:{issue}}`, not `{factory:{issue,stage}}`. Only the backlog's Start posts `{factory:{…}}`, and it sends five fields.
- **Factory** never builds `{factoryDecide}` itself. Decide bodies arrive opaque inside `supervisor.problems[].actions[].body`. The factory plugin handler wants `{factoryDecide:{key, label}}` (`src/composition/plugins/factory/index.ts:729-732`). The registry example `{key, approve:true}` (`src/domain/console-api.ts:124`) is wrong for factory.
- **Team** never posts `{agent}`. It only posts `{role:{define}}` and `{role:{retire}}`.
- **Machines** does show `{fleet:{}}`. It is a scope strip, a down-link alert and a read-only detail view (see Machines §2–4).
- None of the three pages makes a JSON GET (no `/fleet`, `/spend` or `/file`). Every read and write is a POST of a JSON body to the gateway URL that `/config` returns. The POST carries `x-weave-secret` when `?secret=` is in the address, and uses cookie credentials (`src/adapters/primary/ui/dom-js.ts:94-108`).

## Common to all three pages (dom.js kit, `src/adapters/primary/ui/dom-js.ts`)

- **Page frame:** a top bar with a `brand` link to `/` and `<nav id=nav data-current=…>`. Then `main.page`, then `.page-head` holding `h1` and `span.sub`.
- **Refresh with `w.live(refresh)`** (`:144`):
  - It runs `refresh()` immediately.
  - It also runs it after any SSE event on `/events`, debounced to 1500 ms and skipped while the tab is hidden.
  - It runs again on `visibilitychange` back to visible.
  - Every 30 s it re-ticks every `<time data-ts>` without refetching.
  - **There is no polling interval on any of the three pages.**
- **Action helper `w.act`** (`:212`):
  - While pending it disables the buttons and the result span says "Working…".
  - On success the result gets `data-tone=ok` and the `done(j)` text, then `then()` (the re-read) runs after 600 ms.
  - On failure it re-enables the buttons and the result gets `data-tone=bad` with `e.message + " " + e.fix`.
  - An HTTP 401/403 becomes "The gateway refused this page." with a fix line (`:110`).
- **Formatters:**
  - `money(n)`: "$X.XX"; a value above 0 and below 0.01 is "<$0.01" (`:47`).
  - `ago(ts)`: "just now" under 10 s; then "Ns/Nm/Nh/Nd ago" up to 7 days; then a short date like "12 Mar". A future time is "in …".
  - `dur`: under 90 s → s; under 5400 s → m; under 129600 s → h; else d.
  - `when(ts)`: `<time datetime title=localeString data-ts>` holding the `ago` text.
  - `plural(n, one)`: "n one" or "n ones".
- **Other helpers:**
  - `w.navCount(key, n)` puts a badge on the nav entry and adds "(N)" to the title.
  - `w.withSecret(href)` adds `?secret=` to internal links when it is present.
  - `w.loading`, `w.empty` and `w.problem` render `p.note.loading`, `p.note` and `div.problem[role=alert]` (`strong` message + `.fix`).
- **Tone vocabulary** (`data-tone` on `.status`, `.badge` and `.chip`): `ok`, `work`, `needs`, `bad`, `idle`, `""`.

---

## Factory

The page is `/factory` (`src/adapters/primary/factory-page.ts`, served at `factory/index.ts:92`). The title is "Factory · weave".

**Read:** `{factoryBoard:{}}` returns `FactoryBoardView`. The server caches the answer for 3 s (`index.ts:745`). Refresh is `w.live(refresh)` only. The initial loading text, shown in `#issues`, is "Loading the board…". If the read fails, `w.problem` renders into `#issues`.

**Page global:** `autonomous = supervisor.autonomous`. It decides whether Start buttons are offered and the status wording.

### 0. Head
- `h1` "Factory".
- `.sub` "Issues on their way from report to pull request."

### 1. Yolo card (`section.card#yolo`, `:238`)
Hidden (emptied) if `yolo` is absent.

- **Title:** "Yolo mode".
- **When `yolo.on`:**
  - Status (`data-tone=work`): "On — {left} left, until {new Date(expiresAt).toLocaleString()} · turned on by {user ? user+" via "+by : by}{reason ? ": "+reason}".
  - `{left}` comes from `yoloLeft(expiresAt−now)`: "Hh Mm" or "Mm", minutes rounded up.
  - Button "Turn yolo off" (primary) posts `{yolo:{off:true}}`. Done text: "Yolo mode is off."
- **When off:**
  - Status (`data-tone=idle`): "Off" plus a suffix:
    - " — it expired {ago(endedAt)}" when `ended=="expired"`
    - " — a halt ended it" when `ended=="halt"`
    - " — turned off" when `ended=="off"`
  - Then, if `!set && grants.factory`, add: " · this host's FACTORY_AUTONOMOUS still runs the factory until the switch is first used".
  - A `<select class=yolo-pick aria-label="For how long">` with options:
    - 1h "1 hour"
    - 4h "4 hours"
    - 8h "8 hours" (selected)
    - 24h "1 day"
    - 72h "3 days"
  - Button "Turn yolo on" (primary) posts `{yolo:{on:true, for:"<pick value string>"}}`.
  - Done text: "Yolo mode is on until {toLocaleString(j.expiresAt)}." or "Yolo mode is on.".
  - If `j.halt.halted`, the done text is instead "Yolo mode is on, but the fleet is still halted — {why}. Yolo does not lift a halt: nothing runs until you press Resume fleet." It is also shown as a `needs` toast (`dom-js.ts:570`).
- **`.card-why`, verbatim:** "While it is on, the factory advances and re-runs stages, small, evidenced factory pull requests merge themselves (within the cap), and fleet requests (install, start, stop, roles) run without your Approve. It turns itself off when the time is up, or at any halt. Except a stage's own gate commands and what the chief of staff approves inside its hard floor, parked grants and the guard still wait for you."
- **Re-read after either toggle:** `factoryBoard`, plus the top-bar yolo badge refresh.

### 2. Supervisor card (`section.card#supervisor`, `:195`)
Empty if `supervisor` is absent. The title is "Supervisor".

- **Problem split:**
  - `problems` = `supervisor.problems` where `severity !== "watch"`.
  - `inHand` = those where `severity === "watch"`.
- **Status line text:**
  - If `held`: "Waiting — the model's usage limit is reached ({held}); nothing new starts until it passes".
  - Else if `autonomous`: "On — advances each stage's NEXT every {everyS} s" plus either " · last looked {ago(lastScanTs)}" or " · first look within {everyS} s".
  - Else: "Off — each stage waits for you to press Advance. Turn yolo mode on above to let it carry the pipeline (FACTORY_AUTONOMOUS=1 is the old, per-host way)."
- **Status suffix and tone:** if there are problems, append " · {plural(n,'decision')} for you". The tone is `bad` if there are problems, else `ok` if autonomous, else `idle`.
- **Each problem** is a `.ask-block`:
  - `.kind` = `p.title`; `.card-why` = `p.detail`.
  - Then `.actions` built from `p.actions[]` (`AttentionAction`):
    - `{label, href}`: `a.btn`. An internal `/…` href goes through `withSecret`; an external one gets `target=_blank rel=noopener noreferrer`.
    - `{label, body}`: a primary button that posts `a.body` **verbatim**. The body is opaque: `factory`, `factoryAdvance`, `factoryClose`, `factoryNew` or `factoryDecide{key,label}`.
  - The only confirm is when the body has `factoryClose`: "Close #{body.factoryClose.issue}? Its open stages are cancelled, and an issue on the forge is closed there."
  - The page ignores the `ActionLook.confirm` and `tone` fields.
  - Done text, first match wins:
    - `j.closed` → "Closed #{j.issue}."
    - `j.already===true` → "Already closed."
    - `j.taskId` → "Started {taskId}."
    - `j.issue` → "Opened issue #{issue} for the factory."
    - otherwise "Done."
  - The re-read is `factoryBoard`.
  - If there are no actions: `<details class=fix><summary>How to fix</summary><pre>{p.action}</pre>`.
- **No problems:** `.card-why` "Nothing needs you."
- **In hand:** `<details><summary>In hand ({n})</summary><ul>`. Each `li` is `p.title` plus links from the href actions only (`withSecret` rule as above).
- **Recent advances:** `<details><summary>Recent advances ({n})</summary>`. Each `li` is "#{a.issue} → {a.stage}{ok ? "" : " — failed: "+a.error} · {ago(a.ts)}".

### 3. Start new work (`form.card#new-form`)
- **Title:** "Start new work".
- **Why, verbatim:** "Say what you want built or fixed. Weave opens an issue for it and the factory takes it from there — triage, plan, build, verify, ship, review. Anything permanent waits for you here first."
- **Fields** (`.new-fields`):
  - `input#new-title`: maxlength 200, `aria-label` "Title", placeholder "What should be done? e.g. Add a dark mode to the settings page".
  - `textarea#new-body`: rows 3, maxlength 8000, `aria-label` "Details", placeholder "Details, if any: why, where, what done looks like — paste or drop a picture too".
- **Images:**
  - `.thumbs#new-images`, a hidden `input#new-file type=file accept=image/* multiple`, and the button "Add image".
  - Images can be pasted into the body, dropped on the form or picked.
  - At most 3 ("At most three images."). Each is shrunk to JPEG, at most 1600 px, about ≤300 KB base64.
  - Pasting a file into the title says "Paste pictures into the details box."
  - A bad image says "That image could not be read."
- **Submit button** "Start" (primary): an empty title only focuses the title field.
- **Post:** `{factoryNew:{title:string(trimmed), body:string(trimmed), images?:[{type:"image/jpeg", data:<base64 no prefix>}]}}`.
- **Done:** it clears the inputs, then says "Opened issue #{j.issue} on {j.repo}. Triage starts in a moment — it will appear below."
- **Re-read:** `factoryBoard`.

### 4. Backlog (`section#backlog`, `:263`)
Hidden if `backlog` is absent or `issues` is empty.

- `<details class=card><summary>Backlog — not started ({n})</summary>`.
- `.card-why`: "Open issues on {backlog.repo} the factory has not picked up. Start one to send it to triage."
- **Each `li`:** a link "#{number}" to `url` (external, only when it matches `^https?:`, otherwise plain text), then " {title} ", then the button "Start".
- **Start posts:** `{factory:{issue:i.number (number), stage:"triage", title:i.title, url:i.url, repo:backlog.repo}}`.
- **Done:** "Triage started." The re-read is `factoryBoard`.
- **Not used:** `createdAt`.

### 5. Issues
- **Heading:** `h2.section#needs-h` "Issues", plus `span.count` " ({k} need you)" or " (1 needs you)".
- **Nav count:** `navCount("factory", k)`.
- **`p.note#needs`:** k=1 → "One issue needs you — it's first below."; k>1 → "{k} issues need you — they're first below."; k=0 → "Nothing needs you right now."
- **Order:**
  - Completed rows are split out: rows where `board[].completed` is set.
  - Live rows are stable-sorted with "has actions" first, then server order.
  - k = the number of live rows with at least one action.
- **Empty states:**
  - With no live and no completed rows: "No work yet. Start some above — or open an issue on the forge; either way triage starts on its own."
  - With completed rows only, only the Completed details is shown.

**Issue card** (`:176`). The class is `card needs` if it has actions, else `card`.

- **Title:** "#{issue} {title}".
- **Status:** `.status[data-tone]`, from `status(r)` (`:146`). Let `busy` = the first stage whose state is `running`, `queued` or `waiting`.
  - If `pending` is non-empty: `needs`, "Waiting for you — {stageName(busy.stage)} needs your approval".
  - Else if `busy`: `work`. Queued → "{Stage} — queued, waiting for a free slot"; otherwise "{Stage} is working…".
  - Else if `reviewHold` and (`handoff` or (`sameHead` and a suggested next stage)): tone `needs` if handoff, else `ok`; the text is `reviewHold.text`.
  - Else if `next` parses as `^factory:(stage)\s*[—–-]?\s*(note)`: autonomous → `work`, "Ready for {Stage} — the supervisor starts it"; otherwise `needs`, "Ready for {Stage}".
  - Else if `next` with a leading "none — " stripped is non-empty: `ok`, "Finished — {rest}".
  - Else: `ok`, "Finished".
- **Runs line** (`div.runs`), shown only if `runs.total`:
  - "{plural(total,'run')}: " followed by `span.chip[data-tone]` chips, each only if its count is non-zero.
  - Chips: "{done} done" (`ok`), "{open} running" (`work`), "{failed} failed" (`bad`), "{cancelled} cancelled" (`idle`).
- **Approval blocks:** one `.ask-block` per `pending[]` entry `g`.
  - `.kind` = "{Stage of the stage whose taskId == g.taskId, else 'A stage'} {ask(g.tool)}".
  - `ask` map:
    - bash → "wants to run a command"
    - write_file → "wants to write a file"
    - edit_file → "wants to edit a file"
    - git → "wants to run git"
    - propose → "wants to open a pull request"
    - verify → "wants to run the tests"
    - `hexa_X` → "wants to use hexa (X) — this spends Claude credits"
    - anything else → "wants to use {tool}"
  - `<pre>`: `g.detail || g.tool`, with a leading "$ " stripped.
  - "Allow" (primary) posts `{grant:{approve:g.requestId (string)}}`, done "Allowed.".
  - "Deny" posts `{grant:{deny:g.requestId}}`, done "Denied.".
  - Both re-read `factoryBoard`.
- **Start block:** shown only if `next` parses, `!autonomous`, there is no busy stage and `pending` is empty.
  - `.card-why`: "{Stage} will {stage verb}." plus " The last stage said: {note}" when there is a note.
  - Button "Start {Stage}" (primary) posts `{factoryAdvance:{issue:r.issue (number)}}`.
  - Done: `j.already` → "{Stage} is already {j.state}."; otherwise "{Stage} is starting — the forge was labelled.".
  - Re-read: `factoryBoard`.
- **Trail:** `ol.trail` with one `li.step[data-state=<state>]` per `stages[]` entry.
  - Text: "{Stage} {mark}". Marks: done ✓, running …, queued …, waiting ⏳, failed ✗, cancelled –.
  - Then, if there is a model, `span.model` " {shortModel}" plus " ↑ from {shortModel(escalatedFrom)}" when escalated.
  - `shortModel`: `claude-opus-5-5` → "opus 5.5".
  - `title` attribute: "{Stage}: {verb} · {state}{ · model}{ · routedBy}".
- **Footer** (`.card-foot`):
  - "Open issue" links to `url`, external, only if it matches `^https?://`.
  - "History" links to `withSecret("/audit?thread=factory:" + encodeURIComponent(issue))`. Note it is `factory:<N>`, not `factory`.
  - `span.end.num`: "spent {money(usd)}" plus " + hexa {money(hexaUsd)}" if non-zero.
- **Stage names and verbs** (`STAGES`, `:73`):
  - triage Triage "decide what the issue needs first"
  - intent Intent "write down what was asked"
  - design Design "record the design decision"
  - plan Plan "write the plan and the test that proves it"
  - build Build "make the change"
  - verify Verify "prove the change works"
  - ship Ship "push the branch and open the pull request"
  - review Review "review the pull request"
  - close Close "learn from the result and file follow-ups"
- **Fields the page does not use:** `latest`, `pr`, `closedPrs`, `merge`, `provenance`, `waiting`, `updatedTs`, per-stage `usd`/`attempt`/`backend`/`next`, `supervisor.waitingForStable`/`horizon`, and `yolo.since`/`source`/`grants.merge`/`grants.fleet`.

**Completed:** `<details class=card><summary>Completed ({n})</summary>`. Each `li` is "#{issue} {title} · " plus a "History" link to the same audit href.

**CSS to carry over:**
- `.ask-block`: border-top in `--needs-line`.
- `.runs .chip`: pill shape, border colour by tone.
- `.trail .model`: opacity 0.7.

### Factory contract gaps (`docs/api/console-views-v1.d.ts`)
- `FactorySupervisorView.advanced: unknown`. The page reads `[{issue:number, stage, ok:boolean, error?, ts}]`. The real type is at `factory/index.ts:941`.
- `held?: unknown`. It is really a string, interpolated into the status line.
- `FactoryProblem.actions?: unknown[]`. These are really `AttentionAction` (`{label, body}` or `{label, href}`, plus `tone`/`confirm`), defined in the contract file itself (`:20`).
- `FactoryProblem.severity: string`. The page relies on the value `"watch"`; the server also emits `"needs-you"`.
- The `factoryAdvance`, `grant`, `factoryNew` and `factoryClose` responses (`already`, `state`, `closed`, `issue`, `repo`, `taskId`) are not typed views. `ActionResultView.result` is `Record<string, unknown>`.

---

## Machines

The page is `/peers`, with alias `/machines` (`console/index.ts:107`, `src/adapters/primary/machines-page.ts`). The title is "Machines · weave".

**Reads, in parallel inside `refresh` (`:218`):**
- `{machines:{}}` returns `MachinesView`. On error, `w.problem` renders into `#machines`.
- `{fleet:{}}` returns `FleetScopesView`. On error, `fleet=null` and the strip hides itself silently.
- `{fleet}` only matches an object body; `{fleet:"halt"}` is a different verb.

Refresh is `w.live(refresh)` only. The initial loading text, in `#machines`, is "Loading machines…".

### 1. Head
- `h1` "Machines".
- `.sub#summary`:
  - With machines: "{plural(n,'machine')}" plus either ", {q} not heard from" (q = machines with `quiet`) or ", all connected", then ".".
  - With none: "Your machines and the agents running on them."
- **Nav count:** `navCount("machines", q)`.

### 2. Scopes strip (from `{fleet:{}}`)
Hidden if `fleet` is null or `scopes` is empty.

- **Header** (`.scopes-head`): "Scopes on this machine" followed by `#scopes-sum` "· {plural(scopes.length,'scope')} · {totals.liveAgents||0} live agents · {totals.attention||0} needing attention".
- **One card per scope:** `button.scope-card[aria-pressed][data-scope][data-state]`, laid out as a grid with `minmax(160px, 1fr)`.
  - `.scope-name`: `scope`.
  - Chips: if `active`, a badge "this daemon" (`work`). Then a state badge:
    - live → "live" / `ok`
    - attention → "needs attention" / `bad`
    - quiet → "quiet" / `""`
    - dormant → "dormant" / `""`
    - empty → "empty" / `""`
  - `.scope-counts`: "{liveAgents} live · {departedAgents} departed · {plural(silentNodes,'silent node')}".
  - `.card-why`: `why`.
  - CSS: `data-state=attention` gets a 4px left border in `--bad`; `dormant` and `empty` are muted; `aria-pressed=true` gets a `--work` border.
- **Selection:**
  - The initial selection is `location.hash`, decoded. If it is not in the list, the active scope is used, else the first.
  - A click selects the scope and redraws client-side. The hash is not updated.
  - **For htmx this needs a param, e.g. `?scope=`.**

### 3. Scope alert (`#scope-alert`)
One alert per `downLinks[]` entry `l` of the selected scope.

- `div.card.bad[role=alert]`.
- Title: "{l.node} cannot reach {hostOf(l.url)}". `hostOf` strips the scheme and any trailing slash.
- `.card-why`: "{l.error || 'the link is down'} · down {span(forSec*1000)}. {l.node} is live in {scope} but its events do not reach that peer. Bring the peer back, or run weave peers leave <node> --scope {scope}."
- `span` uses the same s/m/h/d rule as `dur`. The literal text `<node>` stays in the sentence.

### 4a. Active scope selected: show `#machines` (from `{machines:{}}`) and hide the detail view
Empty state: "No machine has checked in yet. Start weave on one with: weave serve".

**Machine card** (`:106`). Agents are split into `shown` (not departed) and `gone` (departed).

- **When `allDeparted`:** `card` with title `node`; status (`data-tone=""`) "Not heard from since {when(lastHeardTs)} · {plural(gone.length,'departed agent')}".
- **Otherwise:**
  - The class is `card needs` if `quiet`.
  - Title: `node`.
  - Status: quiet → `needs`, "Not heard from since {when(lastHeardTs)}"; otherwise `ok`, "Connected · last heard {when(lastHeardTs)} · {plural(shown.length,'agent')}" plus ", {w} working" when w > 0.
  - `.card-why` = `remedy`, if present.
  - The agent rows follow.
  - `<details class=more><summary>+{n} departed</summary>`. Each departed line is `.sub` "{name}{ · weave version} · last heard {when(lastSeenTs)}".

**Agent row** (`.row`, `:75`):
- **Name line:** `.agent-name` = `name` (not `agent`), plus `span.muted` " · {role}".
- **Status** (`data-tone`: working→`work`, idle→`ok`, paused→`needs`, silent→`bad`):
  - working with `doing`: "Working on " plus a link "{doing.title}" to `withSecret("/task?id="+encodeURIComponent(doing.taskId))`.
  - paused: "Paused by {paused.by}" plus " — {reason}".
  - silent: "Not heard from since {when(lastSeenTs)}".
  - otherwise: "Idle".
- **Sub line** (`.sub`): "{backend} · weave {version}", nulls dropped. If `outdated`, add a badge "older than {newestVersion}" (`needs`).
- **Buttons:**
  - Paused → "Resume": posts `{agent:{resume:a.agent}}`. `a.agent` is the full id string, not `name`. Done "Resumed.".
  - Not silent → "Pause": confirm "Pause {a.name}? It finishes what it is doing now, then takes no new work until you resume it." Then it posts `{agent:{pause:a.agent, reason:"paused from the console"}}`. Done "Paused.".
  - Silent → no button.
  - Re-read after either: both `machines` and `fleet`.
- **Not shown:** `doing.sinceTs`, `paused.ts`, `MachinesView.now`.

### 4b. Another scope selected: hide `#machines` and show `#scope-detail`, read-only
- **Header:** `h2` `scope`, then `span.muted` "Read-only — this console serves {name of the active scope || 'another scope'}."
- **No nodes:** `p.note`. If `s.error`: "Could not read this scope's log: {error}". Otherwise: "No machine has written to this scope's log."
- **Node card:**
  - The class is `card needs` if `silent`.
  - Title: `node`, plus `span.ref` " · this node" if `self`.
  - Status: silent → `bad`, "Not heard from since {when(lastEventTs)}"; otherwise `ok`, "Last event {when}" or, if `lastEventTs` is 0, "No events".
  - `.card-why`: `hostOf(address.url)` plus " (stale address)" when `!fresh`; with no address, "No address advertised".
  - Links: badges "↑ host" (`ok`) or "↓ host · {error||'down'}" (`bad`), with `title=error`.
  - Agent rows, departed agents in a `+N departed` details, and "No agent has heartbeated from this node." when the node has no agents.
- **Read-only agent row:** `agent` id, status (Live / Departed / Stopped):
  - "Live" (`ok`)
  - "Departed · last heard {when}" (`""`)
  - "Stopped · last heard {when}" (`needs`)
  - Sub: "weave {version}".
- **No Pause or Resume here.**
- **Not shown:** `nodeCount`, scope `lastEventTs`, `link.forSec` on node badges, `totals.scopes`/`departedAgents`/`silentNodes`/`dormantOrEmpty`, and `now`.

**Machines contract gaps:** none. Every field the page reads is in `MachinesView`, `FleetScopesView` or `PeerLinkInfo`.

---

## Team

The page is `/team` (`src/adapters/primary/team-page.ts`, `console/index.ts:143`). The title is "Team · weave".

**Read:** `{team:{}}` returns `TeamViewModel`. Refresh is `w.live`. The initial loading text, in `#roles`, is "Loading the team…". On error, `w.problem` renders into `#roles`.

**While any editor form is open, live re-renders are held** in `latest` and applied when the form closes (`:383-390`). Your templates need an equivalent so a refresh never wipes a form being typed in.

### 1. Head
- `h1` "Team".
- `.sub#summary`: "{plural(roles.length,'role')}, {mine} of them yours (up to {maxRoles})." `mine` counts roles whose `source != "shipped"`. The initial placeholder is "The roles work is sent to, and the ones you make."
- **Nav count:** `navCount("team", idle + refused.length)`, where `idle` counts non-shipped roles with `workers == 0`.

### 2. Refused (`#refused`)
One `card needs` per `refused[]` entry:
- Title: "{name}'s files were not accepted".
- `.card-why`: "The last good version keeps running. Fix the files and save again:".
- `ul.errors` listing `errors[]`.

### 3. Roles (`#roles`)
The list starts with a "New role" button (primary), which opens the editor in `#editor` as a `card`. After it come the role cards.

**Role card:**
- **Head:** `.card-title` `name`, then a source badge (tone `""` if shipped, else `ok`): shipped → "shipped"; yours → "yours"; replaces-shipped → "yours · replaces shipped".
- **Purpose:** `.card-why` = `purpose`.
- **Workers line:**
  - `workers == 0`: `needs`, "No worker running — work sent to this role waits".
  - Otherwise: "{plural(workers,'worker')}" plus ", {working} working" (`work`) or ", idle" (`ok`).
- **Meta lines** (`.role-meta`, each only if set):
  - "Tools: {tools.join(', ')}", or "Tools: everything its worker is granted" when the list is empty.
  - "Its own skills: {x}", taken from `files` keys `skills/<x>/…`.
  - "Fleet skills: {skills}".
  - "Model: {model}".
  - "Budget: {money(budgetUsd)} a task".
  - If `by`: "Changed by {by} · {when(ts)}".
- **Card actions** (`.role-actions`):
  - Shipped `developer`: none.
  - Other shipped roles: "Replace with my own" opens an inline editor seeded with a copy.
  - Yours / replaces-shipped: "Edit" and "Retire".
    - Retire confirm: "Retire {name}? Its worker stops after what it is doing now, and work sent to it waits. Its files are removed; what it made in work/ stays." For replaces-shipped, append " The shipped {name} comes back."
    - It posts `{role:{retire:name}}`, done "Retired.", and re-reads `team`.
- **Files block:**
  - Files come from `files`, or `{"persona.md": markdown}` for a shipped role. With neither, no block.
  - `.role-meta` "Files", plus `span.path` " · {folder}".
  - `table.table.files` with columns File / Kind / Size / (actions).
  - **Order:** persona.md, then AGENTS.md, then `skills/*`, then the rest, alphabetical within each group.
  - **Kind:** persona.md "Who it is"; AGENTS.md "How it works"; `skills/` "Skill"; else "Given to it". The Kind column is hidden under 560px.
  - **Size:** UTF-8 bytes. "N B" below 1024, else "X.X KB".
  - **Row buttons:**
    - "View"/"Hide" toggles a `tr.file-view` holding the rendered file. Frontmatter is shown as `.fm` pre-text; the rest goes through markdown (`w.md`), which builds nodes and **never raw HTML**.
    - Shipped non-developer roles: "Edit", with title "Edits a copy that is yours and replaces the shipped {name}; the shipped files are not changed.". It opens a copy editor at that file.
    - Yours: "Edit". For files other than persona.md and AGENTS.md, also "Delete".
  - **Add row** (yours only): an input with placeholder "new file or skill name", `aria-label` "New file or skill name for {name}", plus "Add file" and "Add skill". These open the editor and pre-add the file.
- **Delete file:**
  - Confirm: "Delete {p} from {name}? Its worker restarts without it."
  - It posts `{role:{define:{name, purpose, tools:[], skills:[], model:string|"", budgetUsd:number|null, overrides:boolean (source==="replaces-shipped"), files:{…all but p, "persona.md": identity||""}}}}`.
  - Done: if `j.ok===false`, "Not deleted: {errors.join('; ')}"; otherwise "Deleted {p}.".
  - Re-read: `team`.

### 4. Editor (`:233`)
It mounts inline in the role card's `.card-editor` slot (as `.card-editor-in`) or in `#editor` (as `.card`). Only one is open at a time.

**Title:** "Edit {name}", "Replace {name} with your own" (for a copy), or "New role".

**Copy note:** "You are editing a copy of the shipped {copyOf}. Saving makes it yours: it replaces the shipped one until you retire it, and the shipped files are not changed."

**Fields:**
- **Name** (`#role-name`, maxlength 40, placeholder "copywriter"). Read-only when editing. Hint: "a role's name does not change" when editing; otherwise "lowercase, with dashes".
- **Overrides checkbox:** "Replace the shipped role of this name". It is shown only while the name matches a shipped role.
- **What it is for** (maxlength 300, placeholder "Writes the words on a page: headlines, buttons, short copy."). Hint: "one sentence; this is also how work is routed to it".
- **Tools:** checkboxes from `view.tools`. Hint: "— the only tools it is offered; pick at least one". With no tools: "This weave is not running a team, so there are no tools to give. Start it with weave dev."
- **Fleet skills** (placeholder "research, sdlc-*"). Hint: "names or patterns, comma separated; optional".
- **Model** (maxlength 80, placeholder "the fleet's default"). Hint: "optional".
- **Budget per task, $** (`inputmode=decimal`, placeholder "the fleet's default"). Hint: "optional".

**Files section:**
- Hint: "— persona.md is who it is, AGENTS.md how it works, skills/ its own skills, and any other file is given to it too".
- A toolbar of file buttons with `aria-pressed`.
- The new-file input (placeholder "style-guide, or a skill's name") with "Add file" and "Add skill". Errors:
  - "Lowercase letters, digits and dashes." (skill), or "…, dots and underscores." (file).
  - "{p} is already here."
- A path label: "{folder}/{p}". For persona.md, add " — its body; the settings above are its frontmatter".
- A textarea beside a live "Preview".
- "Remove this file": hidden for persona.md and AGENTS.md. Confirm: "Remove {current} from this role? It is deleted when you save."

**Seeding:**
- A new role starts with `persona.md = starter.persona` and `AGENTS.md = starter.agents`.
- A new skill is `starter.skill` with `<skill>` replaced by the name.
- A new file is "# {n}\n\n".
- Editing uses `files` with `persona.md` replaced by `identity`.

**Save** ("Save changes", "Save my copy" or "Make role"; primary) posts `{role:{define:{…}}}` with these types:

| field | type | source |
|---|---|---|
| `name` | string | input |
| `purpose` | string | input |
| `skills` | string[] | split on ",", trimmed |
| `tools` | string[] | checked boxes |
| `model` | string (may be "") | input |
| `budgetUsd` | **string**, or null when blank | input, sent as text |
| `overrides` | boolean | checkbox, only when visible |
| `files` | `{path: text}` | editor |

The server coerces `budgetUsd` with `Number()` (`team-roles.ts:260`).

**Save results:**
- `{ok:false, errors[]}` renders the errors into `ul.errors[role=alert]`.
- Success shows the toast "Made {j.role}. Its worker is starting." or "Changed {j.role}. Its worker restarts with the new files.", plus " Saved in {j.folder}" if present. It then closes the form and re-reads `team`.
- A transport error goes to the result span.
- "Cancel" closes the form.

**Team contract gaps:**
- `TeamRow.reportsTo` is in the contract but not displayed.
- The `role` response (`ok`, `role`, `made`/`changed`, `folder`, `errors`) is untyped.
- Everything else the page reads is in `TeamViewModel`.
