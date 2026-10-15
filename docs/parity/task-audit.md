<!-- Read from weave main at c4e6e3a7 (the page adapters this repo replaces). File paths below are weave's. This is the parity checklist the templates are built and checked against. -->

# Parity spec: weave console Task detail (`/task?id=`) and Audit (`/audit`)

Sources I read: `src/adapters/primary/activity-page.ts`, `src/adapters/primary/audit-page.ts`, the shared kit `src/adapters/primary/ui/dom-js.ts` (`weave.md`, `live`, `act`, `money`, `ago`), `src/domain/activity-view.ts`, `src/domain/console-api.ts` (the views and actions), `src/cli.ts:5916-5937` (`auditSelectorFromBody`) and `src/domain/audit-render.ts:75-84`.

**There is no `PAGE_MARKDOWN_JS` on these pages.** That one lives in `src/ports/page-markdown.ts` and only the blackboard and board-classic pages use it. Task detail renders markdown with `weave.md`, at `dom-js.ts:396-461`.

Kit behaviour both pages rely on:
- **Links:** every internal href goes through `withSecret(href)`. If the page URL has `?secret=`, it is added to links that start with `/`. All hrefs also pass `safeHref`: only `/…`, `http(s)://`, `#` and `?` survive, anything else becomes `#`.
- **Money:** `money(n)` gives `"$" + n.toFixed(2)`, and `"<$0.01"` when 0 < n < 0.01.
- **Plurals:** `plural(n, one)` gives `"N one"` or `"N ones"`.
- **Loading state:** `loading(node, text)` draws `<p class="note loading" role="status">`.
- **Error state:** `problem(node, err)` draws `<div class="problem" role="alert"><strong>{message}</strong>`, plus `<div class="fix">` when the error has a fix (the auth refusal does).
- **Actions:** `act()` disables the buttons and sets `data-pending`, writes "Working…" into the result span (with `role=status`), and on success sets `data-tone="ok"` plus the done text and re-reads after 600 ms. On failure it re-enables the buttons and shows `data-tone="bad"` with the message and fix.
- **Buttons:** `button(label)` makes `<button type=button class="btn …">`.
- **Chrome:** both pages use the same top bar: `header.topbar > .topbar-in`, the brand link `/` with `/ds/favicon.svg`, and `nav#nav` with `data-current="activity"`. The audit page also highlights *Activity*, but the contract's NAV has its own `audit` entry (`console-api.ts:37`).

---

## Task detail — `/task?id=<id>`

**Read.** `POST {activity:{id}}` returns `{task: TaskStory|null}` (`composition/plugins/console/index.ts:207`). In /api/v1 this is the `task` view (`pick:"task"`), which refuses with `no-such-task` when the task is missing (`console-api.ts:94-105`). An empty or missing `id` falls back to the list view on the old page (`activity-page.ts:169`). In weave-ui that is a `bad-param` refusal instead.

**Document title.** "Activity · weave" at first. After load it becomes `{title} · Activity · weave` (`:149`).

**Refresh.** `w.live(load)` (`:169`, `dom-js.ts:144-154`):
- Loads once, then re-loads on any `/events` SSE frame. The re-load is debounced to 1500 ms and skipped while the tab is hidden.
- Re-loads on `visibilitychange` to visible.
- Every 30 s it re-ticks `<time data-ts>` nodes; this page has none.
- Each refresh redraws the whole `main`.

**States**
- **Loading:** "Loading the task…".
- **Missing task:** `h1` "No such task", then `<p>` "Nothing in the log has that id. " followed by the link "All tasks" → `/task` (`:164`).
- **Read error:** `problem(main, e)`.

### Sections, in display order (`:150-160`)

1. **Page head:** `div.page-head > h1` shows `task.title`. There is no subtitle.

2. **Status line:** `div.status[data-tone=…]`, built by `sentence()` (`:111-118`).

   | `task.state` | tone | text |
   |---|---|---|
   | `needs-you` | `needs` | "Waiting for your approval" |
   | `working` | `work` | "Being worked on", plus " by {agent}" when `task.agent` is set |
   | `waiting` | `work` | "Waiting for a worker to pick it up" |
   | `failed` | `bad` | "Failed" |
   | `cancelled` | `""` (empty) | "Stopped" |
   | otherwise (`done`) | `ok` | "Done", plus " in {dur}" when both `settledTs` and `declaredTs` are set |

   `{dur}` comes from `ago(declaredTs, settledTs)` with " ago" removed. It reads Ns under 90 s, Nm under 90 min, Nh under 36 h, otherwise Nd. Two quirks: a span under 10 s gives "Done in just now", and a span of 7 days or more gives a date such as "Done in 12 Mar".

3. **`div.actions`** (`:122-133`)
   - **Stop** (`btn danger`), shown only when the state is `working`, `waiting` or `needs-you`.
     - Confirm text: `Stop "{title}"? The worker aborts; what it did so far is kept.`
     - Body: `{cancel: task.taskId}` (a string; action verb `cancel`, kind string).
     - Done text: "Stopped." Then it re-reads the task.
   - **Full record** (`a.btn`) → `/audit?id={encodeURIComponent(taskId)}`.
   - **All tasks** (`a.btn.link`) → `/task`. That is the dropped list view, so weave-ui needs a new target.
   - A `span.result` for action feedback.

4. **"Needs you"** (`h2.section`), shown only when `task.grants` is non-empty. For each grant `g`:
   - A `div.card.needs` containing `.card-title` "It wants to use {g.tool}", then `<pre>` with `g.detail` (or `g.tool` when `detail` is empty).
   - A `.actions` row with:
     - **Allow** (`btn primary`): body `{grant:{approve: g.requestId}}`, done text "Allowed."
     - **Deny** (`btn`): body `{grant:{deny: g.requestId}}`, done text "Denied."
     - Its own `span.result`.
   - Neither button asks for confirmation. Both re-read the task afterwards.

5. **Result / "Why it failed"**, shown only when `task.result` is set. The `h2` reads "Why it failed" when the state is `failed`, otherwise "Result". The body is `div.card.md` holding `w.md(task.result)` (markdown subset below).

6. **"Files it wrote"**, shown only when `task.files` is non-empty. It is one `div.card`. For each path `p` there is a row containing:
   - A link `<a target=_blank rel=noopener title={p}>` whose text is the basename (`p.split("/").pop()`) and whose href is `/file?path={encodeURIComponent(p)}`.
   - Then `span.muted.small` with the text two spaces + the full path.

7. **"What was asked"**: a `div.card` holding `task.asked` in `p.text` (pre-wrap, overflow-wrap anywhere).
   - If it has more than 8 lines, the first 8 lines show, then `<details><summary>Show the whole request</summary><p class=text>` with lines 9 onwards (`:145-148`).
   - This is plain text, not markdown.

8. **"Details"**: a `div.card` holding `dl.facts`, a two-column grid with `dt` muted. A row appears only when its value is truthy, in this order:
   - Worker: `agent`
   - Model: `model`
   - Cost: `money(usd)`; omitted when `usd` is 0
   - Asked: `new Date(declaredTs).toLocaleString()`
   - Finished: `new Date(settledTs).toLocaleString()`
   - Conversation: `thread`, as plain text with no link
   - Started by: shown when `parent` is set; the link "the task that spawned it" → `/task?id={parent}`

### Markdown subset, `weave.md` (`dom-js.ts:397-461`)

Elements are built from text only; there is no raw HTML. Input is capped at 20,000 characters and 400 blocks. Blank lines separate blocks.

**Blocks**
- **Fenced code:** a line starting with ```` ``` ```` opens a block that runs to the next line starting with ```` ``` ````. It becomes `<pre><code>`. The language tag is ignored.
- **Headings:** `#` → `h3`, `##` → `h4`, `###` to `######` → `h5`.
- **Horizontal rule:** `---`, `***` or `___` (3 or more) → `hr`.
- **Tables:** a line starting with `|`, followed by a separator line (`|---`, an optional `:`). Output is `div.table-wrap > table > thead/tbody`, with at most 200 body rows. Cells get inline formatting. Alignment is ignored.
- **Blockquotes:** consecutive lines starting with `>` become a `blockquote`, whose content is parsed again as markdown.
- **Lists:** `-`, `*`, `+` → `ul`; `1.` or `1)` → `ol`. Whether a list is ordered is decided by its first item. A line indented 2 or more spaces continues the previous item, joined with a space. Lists do not nest.
- **Paragraphs:** consecutive non-special lines form one `<p>`, with `<br>` between the lines.

**Inline** (the first match wins, in this order; nesting up to depth 3)
- `` `code` `` → `code`
- `**bold**` → `strong`
- `[text](url)` → `a`
- `*em*` or `_em_` → `em`
- bare `https?://…` → `a`; trailing `.,;:!?` is excluded from the link

Every link gets `target=_blank rel="noopener noreferrer"` and `safeHref`.

**Not supported:** images, strikethrough, nested lists, `__bold__`, HTML.

### Other GETs and gaps

- **`/file?path=`** is served by `sse-surface.ts:1118-1143`. It only serves files an agent wrote; otherwise it returns 404 "no such file — only files an agent wrote can be opened here". The response is sandboxed with a CSP. **weave-ui must proxy or link this endpoint, because the contract has no view for it.**
- **`/events`** (SSE) is used only to trigger refreshes, and also feeds the kit's top-bar freshness indicator ("Live · updated Ns ago", etc., `dom-js.ts:180-199`).
- **`/config`** resolves the gateway URL and fills the nav.
- **`/spend`** is used only by the dropped list view.
- **Contract fields the page never shows:** `claimedTs`.
- **Things the page shows that the contract does not carry:** none. Everything shown comes from `TaskStory`.

---

## Audit — `/audit`

**Read.** `POST {audit:{…}}` returns `{report: AuditReport, verify: AuditHashes}` (`cli.ts:8723-8726`).

**Document title.** Always "Full record · weave".

**Refresh.** None: no `live()` and no SSE-driven refresh. A new read happens only on a form submit or "Check this record". The kit still opens `/events` for the top-bar indicator.

### Static head and filter UI (`audit-page.ts:44-65`)

- **Page head:** `div.page-head`, `h1` "Full record", `span.sub` "Exactly what a run did, what went wrong, and what it cost — every line traceable to the log." The page uses `main.page.wide`.
- **First form,** `form.pick#audit-form`, inside a `div.card`:
  - `select#audit-kind`, aria-label "What to look at". Options are value → label:
    - `subject` → "A task" (the default)
    - `thread` → "An issue or conversation"
    - `workflow` → "A workflow"
    - `since` → "A time window"
  - `input#audit-value`, placeholder `f2-review-3 · factory:2 · 24h`, aria-label "Which one".
  - Button `btn primary` (submit) "Show".
- **Second form,** `form.pick#audit-find-form`, in the same card:
  - `input#audit-find` (type search), placeholder "Find a run: snake game, issue #2 …", aria-label "Find a run".
  - Button `btn` (submit) "Search".
- The inputs have no `name` attributes. Both forms submit in JS (`preventDefault`).
  - **Show** sends `{audit:{[kind]: value.trim()}}` and does nothing if the value is empty (`:225-231`).
  - **Search** sends `{audit:{find: trimmed}}` (`:232`).
- **Output area:** `#audit-out`.

### No query params (the default)

No read happens. `#audit-out` shows `p.note` "Pick a task, an issue or conversation, a workflow or a time window — or search." The kind select stays at "A task", and both inputs are empty. In /api/v1 the `audit` view would refuse with `bad-param` here, so weave-ui should render this prompt itself without a read.

### Query params on load (`:234-243`)

The page checks params in this order and uses only the first one present: `find` → `{find}`, `id` → `{subject}`, `thread` → `{thread}`, `workflow` → `{workflow}`, `since` → `{since}`.
- It pre-fills the controls: `find` fills `#audit-find`; anything else sets `#audit-kind` and `#audit-value`.
- It then runs the read once.
- `until` is never read from the URL or sent.
- `since` is passed through as a string such as `"24h"` or epoch digits. The gateway parses durations as "now minus" (`cli.ts:5922-5929`).
- In /api/v1, `since` and `until` become numbers when they are all digits; otherwise they stay strings (`console-api.ts:237-245`).

How the main cases behave:
- **`?id=X`** becomes `{subject:X}` and shows a single task's record. This is what Activity's "Full record" link uses.
- **`?thread=factory`** is not special in the page; it becomes `{thread:"factory"}`. The fold keeps tasks whose `threadOf(spec)` equals that thread, plus the thread's `chat.summary` and `chat.reset` events (`audit.ts:460-469`). With no matching tasks, `report.notes` gets "thread factory: no turns on this replica". Real links use `?thread=factory:<issue>`; the factory page's "History" link is an example (`factory-page.ts:185`).
- **`?find=q`** becomes a `search` selector. The gateway defaults the window to the last 7 days and the limit to 10 (`cli.ts:5930-5933`).

**After every successful read,** the URL is replaced with `history.replaceState`. It becomes `/audit?find=|id=|thread=|workflow=|since=` (the same precedence), and `&secret=…` is kept (`:200-212`).

**Loading text:** "Reading the log…". **Errors:** `problem(out, e)`. If the answer has no `report`, the error reads "The gateway returned no report." (`:94`).

### Summary card, rendered first (`:184-194`)

All of this sits in one `div.card`:
- **`.card-title`** comes from `sel(report.selector)`:

  | `selector.kind` | text |
  |---|---|
  | `search` | `Search “{query}”` (curly quotes) |
  | `thread` | `Issue or conversation {thread}` |
  | `subject` | `Task {subject}` |
  | `workflow` | `Workflow {x.workflow}` — **bug:** the contract field is `instance` |
  | `window` (fallback) | `Since {new Date(since).toLocaleString()}`; `until` is not shown |
  | missing selector | `This record` |

- **`div.status[data-tone]`**:
  - Tone is `bad` if `summary.failed`, else `work` if `summary.open`, else `ok`.
  - Text: `{plural(summary.tasks,"task")} — {summary.completed} done, {summary.failed} failed, {summary.open} still open`.
- **`.card-why`** (cost line): `money(summary.usd) by weave`, then:
  - ` + money(costs.hexa.usd) by hexa` when hexa is present
  - ` · {tokens(summary.tokens)} tokens`
  - ` · {span(costs.totals.wallMs)} of work` when `wallMs` is set

  Formats:
  - `tokens()`: 1e6 or more → `x.xM`; 1e3 or more → `Nk` (rounded); else the plain number.
  - `span()`: under 1 min → `Ns`; under 90 min → `Nm`; else `Hh Mm`.
- **One `.card-why` per `report.notes[i]`.**
- **`.actions`** contains:
  - The button **"Check this record"** (`#audit-verify-btn`).
  - `span.result#audit-verify`.
  - `span.seq#audit-sha`, whose text is `sha256 {verify.sha256.slice(0,16)}…` and whose `title` is the full sha.

### "Check this record" (`:215-224`)

- It re-POSTs the identical last body. There is no confirm.
- While it runs, the result span shows "Reading the log again…".
- It compares `verify.sha256` with the earlier hash:
  - Match → `data-tone=ok`, "The log still gives exactly this record."
  - Mismatch → `data-tone=bad`, "The log gives a different record now — new events landed in this selection. Show it again to see them."
  - Error → `data-tone=bad` with the error message.
- It does not redraw the report.
- **Quirk:** the sha covers the whole report, including the selector's absolute `since` and `until` (`audit-render.ts:78`). A relative `since=24h`, or any `find` (its window defaults to "now"), re-resolves to new bounds, so it practically always says "different". In weave-ui you could pin `since` and `until` to the first answer's `report.selector` values when re-reading.

### Sections after the summary card (`:133-182`)

Every section is a `<details class="sec" open?>` whose `<summary>` is the title.
- If the section has rows, they go in a `div.card`. If it has none, it shows `p.note` "None."
- If there are more than 10 rows, the first 8 show, then `<details><summary>Show {n-8} more</summary>` holds the rest.
- **Row pattern:** `div.row` containing `div.grow` (main text) followed by `span.seq` citations (`#{seq}`, or `#a · #b` for `cites`).
- **Task links:** a task subject renders as a link to `/task?id={subject}`.

Mistakes are split by `type`:
- **Said no:** `type` is a key of `SAID_NO`.
- **Nudges (agent corrected):** `type` starts with `finding:`.
- **Problems:** everything else.

1. **"Matches ({n})"**, shown only when `summary.matches` exists; open.
   - Per match `x`: the task link `x.subject`, then `span.muted` " · {field} · score {score.toFixed(2)}", then `.sub` `x.snippet`, then `#x.seq`.
2. **"What went wrong ({n})"**, open when n > 0.
   - Per mistake `m`: `span.kind` with the label, then " · ", the task link `m.subject`, `.sub` `m.detail` when set, and `seqs(m.cites)`.
   - Labels come from `PROBLEM` (`:73-78`); unknown types show the raw `m.type`:

     | `type` | label |
     |---|---|
     | `tool-error` | A tool call failed |
     | `task-failed` | The task failed |
     | `verify-failed` | Verification failed |
     | `grant-expired`, `gate:expired` | An approval request expired unanswered |
     | `spend-ceiling` | Stopped at the spending limit |
     | `missing-prompt-capture` | The prompt sent to the model was not recorded |
     | `re-tiered` | Moved to a different model |

3. **"Conflicting answers ({n})"**, open when n > 0.
   - Per contradiction `c`: `span.kind` with the label, " · ", the task link `c.subject`, `.sub` `c.detail`, and `seqs(c.cites)`.
   - Labels: `answer-path-mismatch` → "The answer names a different file than the one the agent wrote".
   - `answerPath` and `reportedPath` are not shown.
4. **"Weave corrected the agent ({n})"**, closed. Same row as "What went wrong"; the label is `NUDGE[type after "finding:"]`, falling back to the raw type (`:83-88`):

   | after `finding:` | label |
   |---|---|
   | `empty-answer` | It gave an empty answer; weave asked again |
   | `native-refusal` | It refused; weave retried |
   | `no-tool-access` | It said it had no tools; weave nudged it |
   | `operator-ask` | It stopped to ask you mid-task; weave retried |
   | `typed-tool-call` | It typed a tool call instead of making it; weave nudged it |
   | `unbacked-claim` | It claimed something it had not done; weave nudged it |
   | `uncalled-tool` | It named a tool it never called; weave nudged it |

5. **"You said no to ({n})"**, closed. Same row; labels from `SAID_NO`:

   | `type` | label |
   |---|---|
   | `gate:denied-by-operator`, `grant-denied` | You denied a call |
   | `task-cancelled` | You cancelled the task |
   | `task-released:cancelled` | Handed back after you cancelled it |

6. **"Tasks ({n})"**, open. Rows have `data-task={subject}`.
   - Per task `t`: the task link `t.subject`, then `span.muted` " · {status label}" and " · {model}" when known, then `.sub` `t.origin` when set, then `#t.seq`.
   - Status labels come from `STATUS` (falling back to the raw value): completed → Done, failed → Failed, released → Handed back, open → Open, cancelled → Stopped. The map also has declared → Waiting and claimed → Working, which `TaskStatus` cannot produce.
   - The model is `modelOf[subject]`, built from `report.models[].resolved`, or "backend default" when a model row exists without `resolved`.
7. **"Cost"** (no count), closed.
   - Per `costs.rows` entry `c`: plain-text `c.subject`, then `span.muted` " · {model or ''} · {tokens(c.tokens)} tokens", plus " · estimated" when `!c.measured`. Then `span.num` `money(c.usd)` and `#c.seq`.
   - Then, per `costs.hexa.rows` entry `h`: `h.subject`, then muted " · {tool} · hexa, {plural(calls,"call")}", then `span.num` `money(h.usd)` and `#h.seq`.
8. **"Models ({n})"**, closed. Per `models` entry `mo`: `mo.subject`, then muted " · {resolved or 'backend default'}", " on {backend}" when set, " · {reason}", then `#mo.seq`.
9. **"What each agent was sent ({n})"**, closed. Per `prompts` entry `p`:
   - `div.kind` "{subject} · attempt {attempt}".
   - System prompt:
     - When `p.system === null`: `.sub` "System prompt: not recorded (declared before it was captured)."
     - Otherwise: `<details><summary>System prompt ({length} characters)</summary><pre class="goal">` (max-height 320 px, scrolls).
   - When `p.tools` is set: `.sub` "Tools offered: {comma list, or 'none'}".
   - `<details><summary>The request as sent ({goal.length} characters)</summary><pre class="goal">{goal}`.
   - Then `#seq`.
10. **"Memory ({n})"**, closed, and shown only when it has rows. The rows, in order:
    - **grounding:** "{subject}: {plural(notes.length,'note')}", plus ", {k} recalled" when `recalled` is non-empty.
    - **calls:** "{subject}: {tool}", plus " (failed)" when `isError`; `.sub` "{args} ⇒ {output}".
    - **events:** "{kind} by {actor}"; `.sub` text.
    - **summaries:** "Summary of {thread}"; `.sub` text.
    - Each row ends with `#seq`.
11. **"Every step ({n})"**, closed, where n is `order.rows.length`.
    - Per row: the `#seq` comes **first**, then `span.kind` kind, " · {subject} · {actor}", `.sub` detail when set, and finally `span.seq` `new Date(ts).toLocaleTimeString()`.
    - Then, per `order.omitted` entry: `p.note` "Not listed on {subject}: {count kind, …} ({'#'+from}–{'#'+to})."

**CSS used:** `.pick`, `details.sec` (summary 600 weight, `--t-lg`), `.row` (wraps, top border), `.grow`, `.sub`, `.seq` (12 px mono, muted), `.kind` (600 weight), `pre.goal`, `.num`, `.muted`, `.note`, `.card`, `.card-title`, `.card-why`, `.status[data-tone]`, `.result[data-tone]`.

### Gaps and mismatches

- **The "A workflow" option does not work.** The page sends `{audit:{workflow:v}}`, but `auditSelectorFromBody` has no `workflow` branch (`cli.ts:5919-5936`). The request falls through to the "since" check and errors with `audit: send {"audit":{"subject":…}}…`. The /api/v1 `audit` view has no `workflow` param either. Drop the option or flag it as unsupported.
- The `sel()` workflow label reads `x.workflow`, but the contract's field is `instance`.
- **Not rendered, though the contract carries them:**
  - `report.fold`
  - `report.provenance`
  - `verify.sections`
  - `summary.mistakes` and `summary.contradictions`; the page counts them itself
  - `costs.totals` apart from `wallMs`
  - per-row token splits, `wallMs` and `latencyMs`
  - `prompts[].grounding`, `utterance`, `context`, `sha256` and `truncated`
  - `tasks[].thread`, `persona`, `skill`, `actor` and `declaredTs`
  - `models[].requested`, `runtime` and `source`
  - `memory.summaries[].upToSeq`
  - `ContradictionRow.answerPath` and `reportedPath`
- The page uses no other JSON GETs (only `/config` and `/events`, both from the kit). Nothing it shows is missing from the contract.
- **Links out of the page:** `/task?id={subject}` from Matches, the three mistake sections, Conflicting answers and Tasks. The Cost, Models, Prompts, Memory and Every-step sections show plain text with no links.
