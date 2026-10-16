# Parity record — weave-ui 0.1.0 against weave v0.2.180

ADR-0234 §8 Phase 2 asks that each page reach parity with the weave page it replaces, with the same actions and the
same data, checked against a live weave running `--console-ui`. This file records that check.

## How it was checked

- **weave:** `main` at `2e067ba0` (tag v0.2.180). It was built with `bun run build:bin` into `/tmp/wv2`, then run
  isolated:
  - its own `WEAVE_HOME` (`/tmp/wv2home`) and an empty working directory;
  - loopback ports 18911 (gateway) and 18912 (console);
  - `--fake`, `--no-discover` and `WEAVE_DISCOVER=off`;
  - no `--peers` and no replication;
  - `--console-ui /tmp/wui2/dist`.

  The running daemon and the `weave-dev-factory` service were not touched. Startup printed
  `console UI: dir:/tmp/wui2/dist@… — 0.1.0, views 1.0 (--console-ui: the pin check is skipped; the purity scan and
  the caps apply)`.
- **Data:** two chat turns and three tasks were declared (`weave task …`). The fleet was halted and resumed through the
  API, and through the templates (below). A role was made through the Team editor.
- **Pages:** weave Phase 1 serves `/ui/f`, `/ui/a` and `/ui/assets` but no page routes, which are Phase 3. So each page
  was opened from its Phase 2 shell at `/ui/assets/pages/<page>.html`. The shell is the same `layout()` the Phase 3
  routes will render. Each one was compared with weave's own page at its legacy URL, captured by headless Chromium
  over CDP at 1280×900 and 390×844.
- **Results:** no console errors, no CSP violations and no horizontal overflow at either width, on any page, once the
  audit fix below had landed. Screenshots of the new pages are in `docs/shots-0.1.0/`.
- **Fixtures:** the fixtures in `test/fixtures/*.live.json` and `*.halted.json` were captured from this weave's
  `/api/v1/<view>`. The `*.full.json` fixtures extend them, by the contract types, to cover every branch.

## Per page

| Page | Matches the weave page | Does not, and why |
|---|---|---|
| **Home** `/` | Head and brief, and Work's sentence linking to /work. The harness panel: verdict, word, sentence, every reason with its fix (command, yolo picker, link), every fact in weave's words, the spend meter. Needs you: grant Allow/Deny with the countdown, stage Start/Close, plan ticked steps and roles, halt Resume plus a new budget, attention items with who-decides, actions and how-to. Decided for you. Working now, with Stop and its confirm. Done recently. Ask weave: markdown answers, panels, files, progress, composer, New conversation. **Live:** pressing *Halt* in the template halted weave (`control.halt.halted: true`), and the refreshed fragment showed HALTED. | weave's topbar halt and yolo controls render inside the harness panel, so they appear on Home, plus Control's Resume. No contract view carries the yolo or halt status to other pages. No "Live · updated" indicator; polling replaces SSE until Phase 3. No image paste in chat. No result text after an action ("Allowed."). Under 1000px the chat panel shows in the page flow; weave's version was behind an "Ask weave" button. |
| **Work** `/work` | Summary sentence. Who is working: machine cards, slots, agents, what each is doing. What is left: issue rows with the step line and links, other work. Where you can help: actions, alternatives, confirms, how-to. The Work nav badge. Screenshots match section for section. | "and N more — see Activity." names a dropped page, as weave's own copy does. |
| **Control** `/control` | Every section and table: budget and its source, halt with who and *Resume fleet* (weave's confirm text, including the budget clause), autonomy and guard, config, peers, Raft, models, hosts, costs with by model, by peer and costliest tasks. Screenshots match pixel for pixel apart from the meter element. | The cost meter is a `<meter>`. weave's inline-width span is blocked by the CSP. |
| **Factory** `/factory` | Yolo card (on/off, why it ended, the picker). Supervisor: decisions with their AttentionAction buttons, in hand, recent advances. Start new work (`factoryNew`). Backlog Start (`factory` with the url only when it is http(s)). Issues ordered needs-you first, with approvals, *Start <Stage>*, runs chips, the stage trail with models, footer and History link. Completed. The nav count follows weave's `actionsFor()`. Screenshots match. | No image paste on new work. |
| **Machines** `/machines` | Machine cards: connected, quiet with its remedy, all departed. Agent rows: working on (linked), paused by, silent, outdated badge, Pause (weave's confirm) and Resume. The scopes strip: state badges, "this daemon", down-link alerts. | weave picks another scope by a click (client state). Here every other scope's read-only detail sits in a `<details>`. The scopes strip follows the machine cards rather than preceding them, because the page head is part of the machines view. |
| **Team** `/team` | Refused files. Role cards: source badge, workers line, meta, files table with View. Retire (weave's confirm, including "The shipped X comes back"). The editor: Edit, Replace with my own (`overrides`), New role from the starter, tools, fleet skills, model, budget, file bodies, add a file or skill, remove a file. **Live:** a role made through the editor, with an added `style-guide.md`, appeared in `/api/v1/team` with all three files. | No live markdown preview while editing, because there is no client renderer. A definition weave refuses (for example starter blanks left unfilled) comes back as `{ok:false, errors}` inside a 200. `/ui/a` only re-renders views, so the errors are not shown (weave PR, below). |
| **Task** `/task?id=` | Status sentence by state, Stop, Full record, grants, Result or Why it failed as markdown, files written, what was asked (folded after 8 lines), details. Screenshots match. | weave's "All tasks" link pointed at the dropped list view; it links Home. |
| **Audit** `/audit` | Picker, summary card, every section with weave's labels, show more past ten, citations, task links, the sha. *Check this record* re-reads the same selector. **Live:** `?since=24h` → "The log still gives exactly this record." The picker loaded `?id=<task>` and updated the URL. | One picker with "Words to find" replaces weave's separate search form. "A workflow" is dropped, because weave's gateway has no workflow selector. The check pins the absolute window, so an unchanged log now says "still gives exactly". weave's page re-resolved `24h` and nearly always said "different". The picker is not pre-filled from the query. An empty `/audit` showed a bad-param error until the shell learned `data-query-required`; it now asks instead. |

## weave changes this needs, which land in weave first

1. **A status view for every page**, for example `bar` = the `{yolo:{status:true}}` answer: yolo, halt, `needsYou`,
   `decidedForYou`. This lets every page carry the topbar's halt, resume and yolo controls and the needs-you title
   badge. This is an additive v1.1 change.
2. **Action results on `/ui/a`.** Render a `result` template from `ActionResultView` (out of band, into a status
   region) beside the refreshed views. Then "Allowed.", "Budget $X — spent $Y", "Opened issue #N" and the `role`
   soft failure `{ok:false, errors}` reach the operator. The `role` handler's soft failure should also become a
   refusal (`action-refused`) rather than a 200.
3. **`formBody` types and the examples.** weave-ui sends JSON (app.js `weave-json`), so it does not depend on this.
   But a form-encoded client gets `approve:"true"`, which weave reads as a **deny** for `fleetDecide`,
   `rolloutDecide` and `releaseMergeDecide`. Two changes:
   - boolean fields per route, and empty fields dropped;
   - those three handlers refuse a non-boolean `approve`.

   Separately, `CONSOLE_ACTIONS` examples are wrong for `factory` (needs a `title`), `factoryDecide` (`{key, label}`),
   `fleetDecide`/`rolloutDecide` (`{id, approve}`), `releaseMergeDecide` (`{version, sha, approve}`) and
   `rolloutAbort` (`{id}`). See `docs/parity/actions.md`.
4. **`refresh` lists:** `yolo` and `fleet` should also refresh `control`.
5. **`/file?path=`** (files a task wrote) has no `/api/v1` route. It is a legacy route that goes in Phase 4 unless it
   gets one.
