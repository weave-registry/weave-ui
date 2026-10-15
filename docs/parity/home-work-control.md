<!-- Read from weave main at c4e6e3a7 (the page adapters this repo replaces). File paths below are weave's. This is the parity checklist the templates are built and checked against. -->

# weave console parity spec: Home, Work, Control

Everything below comes from reading the source. Line refs: `home-page.ts` = HP, `harness-panel-js.ts` = HPJ, `dom-js.ts` = DJ, `work-page.ts` = WP, `control-page.ts` = CP, `docs/api/console-views-v1.d.ts` = d.ts.

**Main gaps to know up front:**
- **Topbar status read.** The header's halt/resume and yolo controls, the Home badge and the "(N) " title prefix all come from `{yolo:{status:true}}`. That response is not in the contract (see Shared).
- **Action responses.** No contract type covers what actions return, but several result messages read fields from it (listed per page).
- **Dropped fields.** Some contract fields are never shown by any of the three pages.
- **CSP.** `CONSOLE_CSP` (`src/domain/console-api.ts:26`) is `style-src 'self'`. The existing meters set `style="width:N%"` inline, which that policy blocks, so the templates need another way to draw them.

---

## Shared: dom.js helpers, nav and topbar (used by every page)

### Formatting helpers (DJ:47-72, 170)
- **`money(n)`** gives `"<$0.01"` when 0 < n < 0.01, otherwise `"$" + n.toFixed(2)`. Null counts as 0, so it prints `$0.00`.
- **`ago(ts, now?)`** gives `"just now"` under 10s. Otherwise it uses `dur(s) + " ago"`:
  - under 90s → `Ns`
  - under 5400s → `Nm` (rounded)
  - under 129600s → `Nh`
  - otherwise → `Nd`
  - From 7 days on it switches to a locale date such as `"12 Mar"`. A future time reads `"in " + dur`.
- **`when(ts)`** renders `<time datetime=ISO title=toLocaleString() data-ts=ms>` with the "3m ago" text. A timer re-renders every `time[data-ts]` every 30s.
- **`until(ts)`** is `when()` plus `data-deadline`. Its `data-tone` becomes `needs` in the last 2 minutes and `bad` once the deadline has passed.
- **`plural(n, one)`** gives `"1 slot"` or `"3 slots"`.
- **States:**
  - `loading` → `<p class="note loading" role=status>`
  - `empty` → `<p class="note">text</p>`
  - `problem` → `<div class="problem" role=alert><strong>msg</strong><div class="fix">fix</div>`
  - A 401/403 gives the message "The gateway refused this page." with the fix "Open it once with ?secret=<the gateway secret> on the address, or sign in. From a network the console trusts (--trust-cidr, ADR-0220) no secret is needed."
- **`withSecret(href)`** appends `?secret=` / `&secret=` to every same-origin link when the page was opened with `?secret=`. Posts send the `x-weave-secret` header.

### `act()` button-press behaviour (DJ:212-225)
1. Disables the buttons and sets `data-pending`. The result `<span class="result">` shows "Working…".
2. On success, the result gets `data-tone=ok` and the text from `done(j)` (default "Done."). The buttons **stay disabled**. It calls `then` after 600 ms (the page re-reads).
3. On failure, the buttons are re-enabled and the result gets `data-tone=bad` and `err.message + " " + err.fix`.

`post()` treats `j.error` as a failure even on HTTP 200.

### Network
- **GET `/config`** finds the gateway URL (`c.gateway.sameOrigin ? route : proto//host:port+route`) and the nav (`c.plugins[].nav`). It is not in the view model. The contract has `RenderCtx.nav: NavEntry[]` instead.
- **SSE `/events`**: one EventSource per page.
- **The three pages make no other JSON GETs** (no `/spend` or `/fleet`). `/file?path=` is only a link.

### Nav (DJ:276-301)
- The `<nav id="nav" data-current="home|work|control">` starts filled with BUILT_IN:
  - Home `/`
  - Activity `/task`
  - Machines `/peers`
  - More `/more`
- It is then redrawn from `/config`: the `nav` entries of enabled plugins, with paths matching `^\/(?!\/)[A-Za-z0-9_\/-]*$`, sorted by `order` (default 50) then label.
- The console plugin's real list (`src/composition/plugins/console/index.ts:70-81`), in order:
  - Work `/work` (5)
  - Home `/` (10)
  - Factory (20, from the factory plugin)
  - Activity `/task` (30)
  - Team `/team` (35)
  - Machines `/peers` (40)
  - Control `/control` (45)
  - Knowledge `/knowledge` (50)
  - More `/more` (90)
- **This differs from `CORE_NAV` in `src/domain/console-api.ts:30-38`**, which is Home, Work, Control, Factory, Machines `/machines`, Team, Audit. Decide which one weave-ui follows.
- Each link is `<a href data-key aria-current="page" if current>`.
- **Badges:** `navCount(key, n)` appends `<span class="badge" data-tone="needs" aria-label="N need you">N</span>`, or removes it when n is 0. Badges survive a redraw.
- **`needsYou(n)`** sets the `home` badge and the `document.title` prefix `"(N) "`.

### Topbar controls (DJ:514-726)
Three nodes are inserted after the nav, in this order: `#yolo-badge.yolo-badge`, `#live-state.live-state`, `#fleet-halt.fleet-halt`.

**Status read: `post({yolo:{status:true}})`. NOT IN CONTRACT.**
- Shape: yolo fields `{on, set, source, grants, since?, expiresAt?, leftMs?, by?, user?, reason?, ended?, endedAt?, endedBy?}`, plus `halt:{halted, drain, cause?, reason?, by?, user?, origin?, who?, since?, budget?:{spentUsd, budgetUsd, over}}`, plus `needsYou`, plus `decidedForYou`.
- Built in `src/cli.ts:5160-5185` and `src/domain/halt.ts:202`. The closest contract type is `FactoryYoloView`.
- Re-read when:
  - the page mounts
  - every 30s
  - the tab becomes visible
  - an SSE `kind` matches `/^(weave\.(halt|resume|yolo)|budget\.|grant\.|release\.merge\.|rollout\.(requested|decided|aborted)|decision\.|plan\.|factory\.)/`, debounced 800 ms
- On success it calls `needsYou(y.needsYou)`.
- On failure:
  - If a status was read before, it is kept and marked `data-stale=true`, with the title "Last known state — the status read failed: …".
  - Otherwise the yolo control shows a disabled `"Status unknown — sign in at /login"` (refused) or `"Status unknown — retrying"`, and Halt is still drawn.

**Yolo switch when on** (`data-on=true`, purple pill):
- Text: `"⚡ Yolo on"`, then:
  - `" · <N> decided for you"`, a link to `/#decided`, when `decidedForYou > 0`. The " for you" part is `.yolo-more`.
  - `" · 3h 12m left"`. The format is `yoloLeft`: `Hh Mm` or `Mm`.
  - `" · by <user||by>"`
  - `" · fleet halted — nothing runs"` when `halt.halted`
- **Turn off** button → `{yolo:{off:true}}` (boolean). No confirm. Done text: "Yolo mode is off."
- Title: "Yolo mode is on until <locale>[ — reason]. The factory, merges and fleet requests run without your Approve; except a stage's own gate commands and what the chief of staff approves inside its hard floor, parked grants and the guard still wait for you."
- If halted, the title is instead: "Yolo mode is on, but the fleet is halted: nothing runs until you press Resume fleet. Yolo does not lift a halt."

**Yolo switch when off:**
- A `.yolo-toggle` button "Yolo off" (`aria-expanded`) opens a hidden `.yolo-menu`.
- The menu holds a `select.yolo-pick` with these options:
  - 1h "1 hour"
  - 4h "4 hours"
  - 8h "8 hours" (selected)
  - 24h "1 day"
  - 72h "3 days"
- It also holds a **Turn on** button (primary) → `{yolo:{on:true, for:"8h"}}`. `for` is a **string**. **No confirm** in the topbar.
- Done text: `"Yolo mode is on until <expiresAt locale>."`.
- If the response has `halt.halted`: "Yolo mode is on, but the fleet is still halted — <reason || cause+' halt' || 'no reason recorded'>. Yolo does not lift a halt: nothing runs until you press Resume fleet." This text also appears as a toast (`tone=needs`).
- Response fields `expiresAt` and `halt` are not in the contract.
- After either switch action, it re-reads the status.

**Halt strip.** It is hidden if `halt` is missing or `halted` is not a boolean.
- **Not halted:** a `button.halt-quiet` "Halt" (styled with a ■ prefix).
  - Confirm: "Halt the fleet? Every worker stops what it is doing and takes nothing new until you resume. Yolo mode ends."
  - Body: `{fleet:"halt"}` (string). Done text: "Fleet halted."
- **Halted** (`data-halted=true`, red pill):
  - `"■ Fleet halted"`
  - `.halt-why " · <reason||cause halt||no reason recorded>"`
  - `" · now $X of $Y"` when `budget` is present
  - `.halt-who " · by <user || origin user@host || by> · <ago(since)>"`
  - **Resume fleet** (primary) → `{fleet:"resume"}`. It asks for confirmation **only when `budget.over`**: "The fleet is still over its budget ($X of $Y). Resumed, it spends again and halts itself at the next claim — raise the budget on Home to keep it running. Resume anyway?" Done text: "Fleet resumed."
- After either action, it re-reads the status.

**Live indicator** (`data-state`; redrawn every 5s and on SSE state changes):
- `"Live · updated 12s ago"`. Gets `data-tone=needs` when the last gateway answer is older than 90s.
- "Connecting…" / "Reconnecting…"
- "Closed — sign in at /login" (link)
- "Not live — reload to update"

### `live(refresh)` (DJ:144-154)
- Calls refresh immediately.
- Calls it again on **any** SSE frame, debounced 1500 ms, skipped while the tab is hidden.
- Calls it when the tab becomes visible.
- Re-renders the ages every 30s without refetching.
- There is no other polling.

---

## Home (`/`, `data-current="home"`, title "Home · weave")

**Data:** `post({home:{}})` → `HomeViewModel`. Refresh is `live(refresh)` plus 600 ms after every action. On error, `problem()` is drawn into `#needs`. The initial state is `loading(#needs, "Loading…")`.

Layout is a 2-column grid: main column plus a 420px sticky chat aside (HP:33-68). At ≤1000px the chat is hidden and a floating **"Ask weave"** button (`#ask-open`) opens it full-screen with a **Close** button.

**Unused by the page:** `now`, `criticalQueued`, `steward`, `reconciler`, and `HomeChat.taskId` / `ts`.

### 1. Page head
- `<h1>Home</h1>`, with `#brief` beside it showing `brief` (`.sub`, empty if missing).
- `#work-summary` shows `work.summary.sentence + " — "` and a link "Open Work" → `/work`. It is hidden when empty (`:empty`).
- It also sets the nav badge `navCount("work", work.summary.help)`.

### 2. Harness status panel (`#harness`, HPJ). Input: `status`
- **Missing status:** `div.harness[data-verdict=idle]` showing "Reading the harness…" (muted).
- **Container:** `div.harness[data-verdict=status.verdict] role=status aria-label="Harness status"`. It has a 6px left border:
  - halted = bad
  - degraded = needs
  - working = work
  - idle = line-strong
- **Head:** `.harness-word` = `status.word` (coloured by verdict), then `.harness-sentence` = `status.sentence`.
- **Reasons:** `ul.harness-reasons > li.harness-reason[data-key=reasons[].key]` holds `reasons[].text`, the fix control, and a result span. Fix by `reasons[].fix.kind`:
  - **`link`:** `a.btn` with `fix.label` → `fix.href`. A `#…` href is used as-is; otherwise it goes through withSecret.
  - **`command`:** a primary button with `fix.label`. It asks `confirm(fix.confirm)`, then posts **`fix.body` as-is**. Done text: "Done.". Then it refreshes Home.
  - **`yolo`:** the shared duration select plus a primary button with `fix.label`.
    - Confirm text: `fix.confirm + " (for " + <option label, e.g. "8 hours"> + ")"`.
    - Then `{yolo:{on:true, for:<select value string>}}`.
    - Done text as in the topbar. Then it re-reads the topbar status and Home.
- **Facts row** (`.harness-facts`, each item a `span.fact`, in this order):
  1. `facts.hosts`: `"{up} of {total} host(s) up"`.
     - plus `" · " + versions.join(", ")`
     - plus `" — not heard: " + down.join(", ")`
     - plus, when `retired` is present, a muted `" · N retired node id(s)"` with the title `"<ids> — not a member, silent over a day: history"`
  2. Each `facts.machines[]`: `"{node} · {cpus} cores · load {load1}[ / {load5}][ · {memAvailablePct}% memory available][ · GPU {gpu.utilPct}%, memory {gpu.memUsedPct}%]"`.
  3. `facts.agents`: `"N agent(s) live"`, plus `" of {total}"` when total > live.
  4. Always: `"{running} running · {queued} queued · {done24h} done · {failed24h} failed in 24h"`.
  5. `facts.spend`, with `pct = round(fraction × 100)`:
     - **When `budgetUsd > 0`:** `"Spend $X of " + limit`. The limit is `"$50"` when the budget is a whole number, otherwise `money`.
     - It is followed by a meter `span.meter[data-tone=over|hot|ok]` (≥100 / ≥90 / else) with role=meter and aria values, a fill of `width:min(100,pct)%`, then `"N%"`.
     - Then `" · frees up " + when(freesAt)` when `freesAt` is present.
     - **Otherwise:** `"Spend $X · no ceiling"`. `spend.windowMs` is unused.
  6. `facts.yolo`:
     - on → `"Yolo on"` plus `" · ends " + when(until)`
     - off → `"Yolo off"` plus `" since " + when(offSince)`
     - `ended` is unused.
  7. `facts.chief`:
     - on → `"Chief of staff on · N act(s) in the last hour"`
     - off → `"Chief of staff off" + " (" + why + ")"` when there is a why
  8. `facts.autonomy`, with `hrs = round(windowMs/360000)/10`:
     - level full and on → `"autonomy: full — N merge(s) in {hrs}h of cap {cap}"`
     - level full and off → `"autonomy: full (off until yolo is on, guard off)"`
     - otherwise → `"autonomy: standard"`
  9. `facts.churn`, only if `churn.stages`: `"factory: {perStage} retries per stage (24h) · N branch-diverged failure(s)"`.
  10. `facts.controlPlane`, only if `peers`:
      - with any `behind` → `"control plane: {behind.length} of N peer(s) behind — agent (difference), …"`
      - otherwise → `"control plane: in sync on {inSync}/{peers} peers"` plus `", {gateways.inSync}/N gateway(s)"`
  11. `facts.breakers`: `"N breaker(s) open"`, then either `", all peers agree"` or `" — {disagree.join} see it differently"`.
  12. Each `facts.modelSources[]`: `"{setting} differs: {gateway} {value} ({source}) · …"`.
  13. `facts.usageLimit`: `<strong>Claude account at its usage limit</strong>`, then `" until " + toLocaleString(until)`, then either `" — failing over to " + lanes` or `" — " + (remedy || "no lane to fail over to")`.
  14. `facts.control`: a link "Control plane, models and costs →" → `facts.control` (e.g. `/control`).
  15. `facts.controlRaft`:
      - **`mode:"off"`:** `span.fact.muted aria-disabled data-fact=control-raft` showing "Raft control plane: off — log mode", with the title "--control-plane=shadow on a voter runs the Raft group beside the AP fold (ADR-0216)".
      - **Shadow with divergence:** "Raft control plane (shadow): {agree}/N host(s) agree — {node} differs for {forSec} s, …".
      - **Shadow in agreement:** "Raft control plane (shadow): in agreement on {agree}/N host(s)".
      - Then, for each `frozen[]`: `" · no quorum: control frozen on {node} since " + when(since)`.
  16. Always: a link `"Needs you: {facts.needsYou}"` → `#needs-h`.
  17. `facts.reconcile`:
      - **With `lastTs`:** `"Reconciled " + when(lastTs) + " · N drift finding(s) · {fixed} fixed · {left} left"`, plus `" · now off (why)"` if it is off.
      - **Otherwise:** `"Reconciler on · no pass yet"` or `"Reconciler off (why)"`.
  18. `facts.backlog`, when it is a number: a link `"N issue(s) not started on the forge"` → `/factory`.
  19. `facts.decisions`: a link `"{open} open decisions"` → `/knowledge`, then `" ({proposed} proposed · {acceptedOpen} accepted, not complete)"`.

### 3. Needs you (`#needs-h`, `#needs`). Input: `needs[]`
- **Heading:** "Needs you", plus `span.count " (N)"` where N counts only `severity==="needs-you"`. It also calls `needsYou(N)`, which sets the Home badge and the "(N) " title prefix.
- **Cards** are keyed by `needs[].key` (reconcile). An unchanged card keeps its DOM node, so ticked boxes, typed values and result text survive a refresh, and a card that has focus or is mid-press is never replaced.
- **Empty state:** "Nothing needs you right now."

**Shared card meta** (`.card-meta`):
- `"Asked " + when(askedTs)`
- plus `" · denied by silence " + until(expiresTs)`. This is a countdown: `<time data-tone=needs|bad>` turns amber, then red.

**Kind `grant`** (`card needs`)
- **Title:** `(task || "A task") + " " + phrase(tool)`. The phrases:
  - bash → "wants to run a command"
  - write_file → "wants to write a file"
  - edit_file → "wants to edit a file"
  - git → "wants to run git"
  - propose → "wants to open a pull request"
  - verify → "wants to run the tests"
  - `hexa_X` → "wants to use hexa (X) — this spends Claude credits"
  - anything else → "wants to use <tool||'a tool'>"
- Then the meta, and `<pre>` = `call.join("\n")` when present.
- **Allow** (primary) → `{grant:{approve: grantId}}` (string). Done text: "Allowed."
- **Deny** → `{grant:{deny: grantId}}`. Done text: "Denied."
- No confirm on either.

**Kind `stage`** (`card needs`). Stage names: triage Triage, intent Intent, design Design, plan Plan, build Build, verify Verify, ship Ship, review Review, close Close. An unknown stage shows its raw name.
- **Title:** `span.ref "#{issue} {title} — "` + `"ready for {Stage}"`.
- Meta.
- **`.card-why`:** `"{Stage} will {verb}."`, plus `" The last stage said: " + note`. The verbs:
  - triage → "decide what the issue needs first"
  - intent → "write down what was asked"
  - design → "record the design decision"
  - plan → "write the plan and the test that proves it"
  - build → "make the change"
  - verify → "prove the change works"
  - ship → "push the branch and open the pull request"
  - review → "review the pull request"
  - close → "learn from the result and file follow-ups"
  - anything else → "run"
- **"Start {Stage}"** (primary) → `{factoryAdvance:{issue}}`. `issue` is a **number**. Done text: "{Stage} is starting — the forge was labelled."
- **Close** → confirm "Close #{issue}? Its open stages are cancelled, and an issue on the forge is closed there." Then `{factoryClose:{issue}}` (number). Done text: `j.already===true` gives "Already closed.", otherwise "Closed #{issue}.".
- Link `a.btn.link` "Open Factory" → `/factory`.

**Kind `plan`** (only when `plan` is present; `card needs`)
- **Title:** "The chief of staff proposes: " + `plan.summary`.
- Meta.
- When `task` is set: "For: " + a link to `/task?id={plan.request}` with the text `task`.
- **Step rows** (`label.plan-step`), one checkbox each, **checked by default**:
  - **factory step:** `badge[data-tone=work] "factory"` + `<strong>title</strong>` + `.card-why body`
  - **role step:** `badge` role + goal
  - plus `.card-why "about $X"` when `costUsd` is set
- **Role rows** (`plan.roles[]`), checkbox **unchecked by default**: `badge[data-tone=needs] "new role"` + `<strong>name</strong> — purpose` + `.card-why "Why: {why} · Tools: {tools.join(", ")}"`.
- **"Start ticked"** (primary) → `{plan:{accept: plan.id, steps:[<indices of ticked steps, numbers>], roles:[<ticked role names, strings>]}}`.
  - The done text is built from the response, which is **not in the contract**. Parts, joined with " · ":
    - `declared[]` → "N step(s) sent to the team"
    - `factory[].issue` → "issue #N, … opened for the factory"
    - `roles[]` → "N role(s) made"
    - `failed[].{item,error}` → "N not started: item — error; …"
  - If none of these apply: "Started."
- **Decline** → `{plan:{decline: plan.id}}`. Done text: "Declined."

**Kind `halt`** (`card needs`)
- Title is `title`, then meta.
- **Resume** (primary) → `{fleet:"resume"}`. No confirm. Done text: "Work resumed."
- **Budget input:** `<input type=number min=0 step=5 placeholder="$ per day" aria-label="New budget in dollars per day">`.
- **"Raise budget"** → `{budget:{usd: Number(input)}}`. `usd` is a **number**.
  - Validation: if the input is empty or not ≥ 0, the result shows "Enter dollars per day (0 = no ceiling)." and nothing is posted.
  - Done text: "Budget ${j.budgetUsd} — spent ${j.spentUsd}", plus ". Work resumed." if `j.resumed`, ". Still over: raise it further." if `j.over`, otherwise ".". These response fields are **not in the contract**.

**Kind `attention` and any other kind** (class `card needs` if severity is needs-you, otherwise `card`)
- Title is `title`, then meta, then `.card-why detail`.
- **`whoDecides`** is shown as `.card-who[data-tone=auto]` if it starts with "Yolo", otherwise `[data-tone=needs]`.
- **Actions** (`actions[]`, AttentionAction):
  - **`href` action:** `a.btn` (tone ignored). A `/`-path goes through withSecret; any other link opens in a new tab (`target=_blank rel="noopener noreferrer"`).
  - **`body` action:** a button classed by `tone`:
    - danger → `btn danger`
    - quiet → `btn`
    - primary **or missing tone** → `btn primary`
  - Press sequence: `confirm(a.confirm)` if set. Then, if `body.factoryClose` is present, a second confirm: "Close #{n}? Its open stages are cancelled, and an issue on the forge is closed there.". Then it posts `a.body` as-is.
  - Done text, first match wins:
    - `j.closed` → "Closed #{j.issue}."
    - `j.already===true` → "Already closed."
    - `j.taskId` → "Started {taskId}."
    - `j.issue` → "Opened issue #{issue}."
    - otherwise → "Done."
- **`action`** (text) is shown in `<details class="fix"><summary>`, with summary "Details" if there are buttons, otherwise "How to fix". The text is in a `<pre>`.

### 4. Decided for you (`#decided-h`, `#decided.card`). Input: `decided[]`
- **Heading:** "Decided for you", plus `count " (N)"`, plus `.sub " · last 24 h"`.
- **Row:**
  - `badge[data-tone=auto]` = `by` ("yolo" or "chief of staff")
  - `what`, with `.sub why` when present
  - meta: `when(ts) · ` link "Audit" → `href` (e.g. `/audit?…`)
- **Empty state:** "Nothing was decided for you in the last 24 hours."

### 5. Working now (`#working.card`). Input: `working[]`, `queued`
- **Row:**
  - a link `title` → `/task?id={taskId}`
  - `.sub "by {agent}"`
  - meta `when(sinceTs)`
  - **Stop** (`btn link`): confirm `Stop "{title}"? The worker aborts; what it did so far is kept.`, then `{cancel: taskId}` (string). Done text: "Stopped."
- When `queued > 0`: `p.muted.small "N task(s) waiting for a worker."`
- **Empty state:** "Nothing is running."

### 6. Done recently (`#done.card`). Input: `done[]`
- **Heading:** "Done recently", with link "All tasks" (`a.more`) → `/task`.
- **Row:**
  - `span.mark[data-state=state]` showing ✓ (done, ok colour), ✗ (failed, bad) or – (cancelled, muted)
  - a link `title` → `/task?id=`
  - `.sub` = (`"Failed: "` if failed) + `summary`
  - meta `when(ts)`
- **Empty state:** "Nothing has finished yet."
- **Footer:** `p.muted.small` "The older console, with the event feed and voice, is under More → Diagnostics."

### 7. Ask weave chat (aside `#chat-panel`). Input: `chat[]`, oldest first
- **Head:** `h2` "Ask weave", a button "New conversation" (`btn link`, title "Start a new conversation"), and a Close button (mobile only).
- **Empty state:** muted "Ask anything — what the fleet is doing, or work you want done. You can paste a picture too."
- **Your turn** (`.turn.you`, right bubble): `asked`, pre-wrap.
- **weave turn** (`.turn.weave`): `.who "weave"`, then the first match:
  - `answer` → **rendered as markdown** (`w.md`, DJ:418-461). Supported: h1-3 drawn as h3-h5, bold, italic, code, fenced code, lists, quotes, rules, tables, links, bare URLs. Capped at 20k characters and 400 blocks. All links open in a new tab and go through safeHref.
  - `state==="working"` → `.working` "Working on it" + `" · " + when(sinceTs)`, with `ul` of `progress[]`
  - `state==="waiting"` → "Waiting for a worker…"
  - `state==="failed"` → "That didn't work."
  - done with no answer → nothing
- **Panels:** each `panels[]` is drawn by `w.panel`. The types are show_metrics, show_table, show_chart, show_answer and show_ui component trees (DJ:329-394). The **contract types these only as `Record<string,unknown>`**, so the template needs that schema from DJ.
- **Files:** "Wrote: " + links (text = basename, title = full path) → `/file?path={encoded}` in a new tab.
- **Scrolling:** the log stays pinned to the bottom unless the user has scrolled up more than 60px.
- **Composer:**
  - textarea placeholder "Ask a question or describe work to do — paste or drop an image". It auto-grows to 200px. Enter sends; Shift+Enter is a new line.
  - hint `#ask-result`: "Enter sends · Shift+Enter for a new line. Anything permanent comes to Needs you first."
  - buttons "Add image" and "Send" (primary)
- **Images:** up to 3, added by paste, drop or the picker. Each is re-encoded as JPEG (at most 1600px, about 300 KB base64) and shown as a thumbnail with a ✕ remove button. "At most three images." and "That image could not be read." are the messages.
- **Send** → `{chat:{text: trimmed}}`, plus `images:[{type:"image/jpeg", data:<base64>}]` when there are images. Nothing is sent if both are empty.
  - Done text: `String(j.answer)` if present (**not in the contract**), otherwise "Asked — weave is on it."
  - Clears the box and the images, scrolls to the newest turn, and re-enables Send.
- **New conversation:** confirm "Start a new conversation? Weave stops carrying this one into its answers; it stays in the record.", then `{chat:{reset:true}}` (boolean). Done text: "New conversation."

### Home links (all)
- `/work`
- `/task?id=`
- `/task`
- `/factory`
- `/knowledge`
- `facts.control`
- `#needs-h`
- harness fix `href`s
- `decided[].href` (/audit…)
- `actions[].href`
- `/file?path=`
- `/#decided` (topbar)

---

## Work (`/work`, `data-current="work"`, title "Work · weave")

**Data:** `post({home:{}})`, then it uses `.work` (`WorkView`). Refresh is `live(refresh)` plus 600 ms after an action. On error, `problem()` is drawn into `#who`. Initial state: `loading(#who, "Loading…")`.
- If `work` is missing: empty "This weave does not report work yet."

**Unused fields:** `WorkView.now`; `WorkMachine.memAvailablePct`; `WorkAgent.agent` / `lastSeenTs`; `WorkDoing.title` / `issue` / `step`; `summary.machines`.

### Head
- `<h1>Work</h1>`
- `#summary` starts as "Who is working, what is left, and where you can help." and is replaced by `summary.sentence`.
- Sets `navCount("work", summary.help)`.

### 1. Who is working (`#who-h`, `#who.machines`, card grid minmax 320px)
- **Heading:** "Who is working" + `count " ({summary.inUse} of N slot(s) in use)"`.
- **Machine card:** `card needs` if `machines[].quiet`, otherwise `card`.
  - **Title:** `node` + `.slots "{inUse} of N slot(s) in use"`.
  - If `quiet`: `.status[data-tone=bad] "Not heard from since " + when(lastHeardTs)`.
  - If `idleWhy`: `.card-why "Idle: {idleWhy}"`.
- **Agent row**, for each `agents[]` (`.agent`):
  - `.status[data-tone]` holding `.name name`, `.role " · {role}"` and `.slots "{inUse} of N slot(s) in use"`. The tone is working → work, idle → ok, paused → needs, silent → bad.
  - **With `doing[]`:** a `ul` with one `li` each: a link `words` → `/task?id={taskId}`, then `" ({took(sinceTs)}[, {model}])"`. `took` uses the same buckets as ago() but has **no "ago"**: `3m`.
  - **Otherwise:** `.why` reading "Paused" / "Silent" / "Idle", plus `" — {idleWhy}"`.
- **Empty state:** "No machine has checked in yet. Start weave on one with: weave serve"

### 2. What is left (`#what-h`, `#counts`, `#what.card`, `#other`)
- **Counts line:** "N issue(s) in progress · N step(s) queued · {merged} merged today", from `summary.issues`, `summary.queued` and `summary.merged`.
- **Issue row** (`issues[]`):
  - **Head:** `<strong>title</strong>` + muted `" #{issue}"`.
  - Link `btn link` "Issue" → `url` (new tab).
  - Link "Pull request #{pr.number}" → `pr.url` (new tab).
  - **Progress line:** `ol.line` of pills, one `li[data-state=steps[].state][data-tone=<tone if current>][title=state]` each.
    - Labels: triage Triage, design Design, plan Plan, build Build, verify Verify, review Review, merge Merge.
    - Treatment: done = ok colour; skipped = 55% opacity, struck through; current = bold and toned.
    - Issue state → tone: running → work, queued → none, waiting → needs, held → bad.
  - `.state[data-tone]`: `"{Step(step)}: {words} · " + when(sinceTs)`.
- **Empty state:** "No issue is in the pipeline."
- **Other work** (only when `other[]` is non-empty): a card titled "Other work".
  - Each row: a link `title` → `/task?id={taskId}`, then `.state[data-tone=work if state==="running"] "{words} · " + when(sinceTs)`.
  - Plus `p.muted.small "and {otherMore} more — see Activity."` when `otherMore` is set. This has **no link**.

### 3. Where you can help (`#help-h`, `#help`). Input: `help[]` (WorkHelp)
- **Heading:** "Where you can help" + `count " ({summary.help})"` when non-zero.
- **Card** (`card needs`):
  - title
  - `.card-why "Why you: {why}"`
  - `<pre>detail</pre>`
  - actions
  - `<details class="fix"><summary>How</summary><pre>how</pre>` when `how` is set
- **Action buttons:** `action` is the primary button and each `more[]` item is a plain one.
  - **`href` action:** `a.btn[.primary]`. A `/`-path goes through withSecret; anything else opens in a new tab.
  - **`body` action:** a button. It asks `confirm(a.confirm)` if set, then posts **`a.body` as-is**. All of the card's buttons are disabled together.
  - Done text: `"{label} — done."`.
  - There is no tone on WorkAction.
- **Empty state:** "Nothing needs you."

**Links:** `/task?id=`, `issues[].url`, `pr.url`, action hrefs.

---

## Control (`/control`, `data-current="control"`, title "Control · weave")

**Data:** `post({control:{}})` → `ControlView`. Refresh is `live(refresh)` plus 600 ms after Resume. On error, `problem()` is drawn into `#sec-control`. Initial state: `loading(#sec-control, "Loading the control plane…")`.

**Ages:** `ago(ts)` is measured against `now + (Date.now() − fetchedAt)`. It renders `<time title=locale>` **without `data-ts`**, so the 30s re-render does not update it.

**Missing data:** a section with no data is shown, not hidden. `unavailable(u)` renders `p.unavail role=status`: `<strong>{why}</strong> — {remedy}`.

**Truncated lists:** `note(list)` renders `p.unavail list.note` when `count < total`.

**Unused fields:**
- `ControlSection.halt.who`
- `yolo.since`
- `ControlValue.eventId`
- `HostRow.accounts`
- `openBreakers[].since`
- `RaftSection.term` / `leader` / `commit` / `quorum`
- `RaftVoterRow.frozenSince`, `lastContactSec`, `reportedAt`, `apDigest`, `raftDigest`, `lastSeenSec`
- `CostsSection.tokens`
- `byModel.tokens`

### Head
- `<h1>Control</h1>`
- `#summary` starts as "The control plane the log holds, the models work ran on, and what it costs."
- It is replaced by: `"{Halted|Running} · budget {money(control.budget.usd)} {(log)|(startup)} · {money(costs.spentUsd)} spent in {costs.windowHours}h · N task(s) in {models.windowHours}h."`
  - Halted/Running comes from `control.halt.halted`. The task count is `models.tasks.total`.

### 1. Control plane (h2 "Control plane")

**`#sec-control`, a grid of 3 cards:**
- **Budget card.** Uses a `dl.kv`.
  - **Fleet:** `"{money(budget.usd)} per {windowHours}h · " + src(budget)`.
  - **Per task:** `perTaskUsd.usd > 0 ? money : "no ceiling"`, then `" · " + src(perTaskUsd)`.
  - **`src(v)`:** for `source=="log"`, "set on the log" + `" by {setBy}"` + `" · " + ago(setAt)`. Otherwise "startup default (no budget.set on the log)".
- **Halt card** (`control.halt`):
  - **Not halted:** a `card` titled "Running" with `.status[data-tone=ok]` "Not halted — peers claim normally."
  - **Halted:** a `card bad` titled `"Halted" + (drain ? " (drain)" : "")`.
    - `.status[data-tone=bad]`: `"{cause} · " + (reason || "no reason recorded")`.
    - kv **Who:** `origin.user@origin.host`, `" · pid {origin.pid}"`, `" · {by}"` when the origin has a user or host. Otherwise `user || by || "unknown"`.
    - kv **Since:** `ago(since)`.
    - kv **From:** mono `origin.parent`.
    - kv **In:** mono `origin.cwd`.
    - **"Resume fleet"** (primary). Confirm: "Resume the fleet? Peers start claiming and spending again" + (`cause==="budget"` ? " — and a budget halt comes back while the spend is still over." : "."). Then `{fleet:"resume"}`. Done text: "Resumed."
- **"Autonomy and guard" card.** kv:
  - **Yolo:** `on ? "on" + " until " + toLocaleString(until) + " · by {by}" : "off" + " ({ended})"`.
  - **Guard:** `guard.mode` + `" · set by {by}"` + `" · " + ago(since)`.
  - **Digest:** mono `digest`.
- **Config table** (`control.config.results`) with columns:
  - Config path (mono `path`)
  - Value (mono; objects are JSON-stringified)
  - Set by (`by`)
  - When (`ago(at)`)
  - Followed by the truncation note.
  - Empty: "No config path is set on the log — every setting is its default (weave config schema lists them)."

**`#sec-peers`** (`control.peers.results`, PeerSyncRow):
- **Status line** `.status[data-tone]`. Tone: bad if any `behind`, ok if there are peers, otherwise none.
  - Text when there are peers: "N of M behind the log", or "In sync on M/M". Then " — peers and gateways" if any row has `kind==="gateway"`, otherwise " peers".
  - Text with no peers: "Peers: unknown".
- `unavailable(control.unavailable)`.
- **Table** with columns:
  - Peer: `agent`, plus small muted " · gateway"
  - Host: `node`
  - Applies: badge `state`. Tone: in sync = ok, behind = bad, settling = needs.
  - Difference: `difference`
  - Followed by the truncation note.

### 2. Raft control plane (h3.small, `#sec-raft`). Input: `raft`
The section is drawn only if `raft` is present. The page guards for it even though the contract makes it required.
- **Status line:** `.status[data-tone]` = `raft.summary`. Tone:
  - mode log → none
  - frozen → bad
  - silent, or any non-stale voter that diverges → needs
  - otherwise → ok
- `unavailable(raft.unavailable)`.
- **Silent card** (`card needs`): "Silent: {silent.nodes.join}", with `.card-why "{silent.message} — is the voter's peer down, or back in log mode? Each row below is its last known state."`.
- **Frozen card** (`card bad`): title `frozen.message`. Why: "A loosening (resume, raise, yolo on) is refused until a quorum returns; a tightening still applies. Not fresh: {nodes}", plus " · since " + ago(since).
- **Voters table** (`voters.results`). `secs()` gives <120 → `Ns`, <7200 → `Nm`, otherwise `Nh`.

| Column | Content |
|---|---|
| Voter | `<strong>node</strong>`, plus a `badge needs "stale"` if stale. Sub-line: stale → `"last seen " + ago(lastSeenAt) + " · by {agent} · its last known state"`; otherwise `"reported by {agent} · {secs(reportedSec)} ago"` |
| Role | badge `role \|\| "?"` (ok tone if leader) |
| Term | `term` (num) |
| Leader | `leader \|\| "?"` |
| Commit | `commit` or "?" (num) |
| Applied | `applied` (num) |
| Last contact | `ago(lastContactAt) \|\| "?"`, plus a `badge bad "frozen"` if not `fresh` |
| Shadow | badge "agrees" (ok) or `"diverges" + " for {secs(divergentSec)}"` (needs) |

Followed by the truncation note.

### 3. Models (h2 "Models")

**`#sec-models`** (`models`):
- **Usage-limit card** (`usageLimit`): class `card needs` if there are lanes, otherwise `card bad`.
  - Title: "Claude account at its usage limit" + " until {locale(until)}".
  - Why, with lanes: "Failing over to {lanes} — each re-routed task says failover:usage-limit below."
  - Why, with no lanes: `remedy`.
- `unavailable(models.unavailable)`.
- **By-model line:** `p.small "Last {windowHours}h by model: "` then `<strong>model</strong> N task(s)`, separated by " · ". Source: `byModel.results`.
- **Tasks table** (`tasks.results`):

| Column | Content |
|---|---|
| Task | link `title \|\| task` → `/task?id={task}` |
| Named | mono `model \|\| "peer default"` |
| Ran on | mono `ran \|\| "—"`, with a sub-line `"{backend} · {runtime} · {by}"` |
| Why | `routedBy \|\| reason`, plus `div.small[data-tone=needs] rerouted` |
| When | `ago(ts)` |

Followed by the truncation note.

**`#sec-hosts`:**
- **Model settings**, for each `declarers.results[]`: an `h3.small "Model settings on {gateway}"`, then a table with columns:
  - Setting (mono)
  - Value (mono, `value ?? "—"`)
  - Source: badge, ok tone if `log`
- Empty: "No gateway reports its model settings yet — a gateway on a build older than ADR-0213 sends none; weave upgrade there."
- `unavailable(models.hostsUnavailable)`.
- **Hosts table** (`hosts.results`, HostRow):

| Column | Content |
|---|---|
| Host | `<strong>node</strong>` + small muted `agents.join` |
| Default model | mono, or "—" |
| Backend | `backend`, or "—" |
| Lanes | `lanes ? (lanes.join \|\| "none") : span.unavail (note \|\| "unknown")` |
| Open breakers | one `badge bad "{key} · {cause}"` per breaker, or "none" |

No truncation note is shown here.

### 4. Costs (h2 "Costs", `#sec-costs`). Input: `costs`
- **Main card:** `card`, plus ` bad` when `over`. `pct = budgetUsd > 0 ? min(100, round(fraction × 100)) : 0`.
  - `span.big money(spentUsd)`.
  - With a budget: `" of {money(budgetUsd)} in the last {windowHours}h ({pct}%)"`. Without one: `" metered in the last {windowHours}h — no fleet budget"`.
  - Then a basis badge (tone ok if "measured", otherwise needs).
  - **Meter** (only with a budget): tone bad if over, needs if ≥90%, otherwise none.
  - **`.card-foot`:**
    - "Per-task ceiling: " + `(perTaskUsd > 0 ? money : "none")`
    - `"{money(remainingUsd)} left"`, shown only when `remainingUsd` is not null
    - "Same figures as weave spend"
- `unavailable(costs.unavailable)`.
- **Two-column grid:**
  - **"By model"** (`byModel.results`): Model (mono), Spend (num, money), Tasks (num), and an unlabelled basis badge. Empty: "none".
  - **"By peer"** (`byPeer.results`): Peer, Spend (num), basis badge. Empty: "none".
  - Neither table shows the truncation note.
- **"Costliest tasks"** (`byTask.results`): Task (link `title || task` → `/task?id=`), Spend (num), basis badge. Followed by the truncation note. Empty: "none".

**Actions on Control:** only Resume fleet, plus the topbar controls.

**Links:** `/task?id=` only.
