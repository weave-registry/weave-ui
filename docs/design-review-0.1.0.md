# Design review — weave-ui 0.1.0

This is ADR-0234 §8 Phase 2's design-review pass, run with weave's `design-review` skill: five lenses ran as
independent agents, then their findings were synthesised. Date: 2026-10-15.

## Evidence

The review used 1280×900 and 390×844 screenshots of all eight pages, plus Home and Work with the fleet halted. Each
page was its Phase 2 shell, served by an isolated weave v0.2.180 (`--fake --console-ui dist/`, own `WEAVE_HOME`,
loopback, no replication). The legacy pages were captured beside them. The desktop shots are in
`docs/shots-0.1.0/`. Sources reviewed: `src/templates/*`, `src/ui/*`, `src/layout.ts`, `assets-src/{app.js,weave.css}`,
the parity checklists, and the weave pages they replace.

This is weave-ui's first review. The skill's verdict artifact covers weave's old console, so there is no earlier
weave-ui review to measure movement against; this record is the baseline.

## Verdict

**The page set and the rendering model are sound. The client chrome needed one pass before 0.1.0, and that pass is in
this PR.** The pages reproduce the old pages section for section (`docs/parity-0.1.0.md`). Control, Factory, Task and
Audit are near pixel-identical to the legacy pages. The structural gap is the one ADR-0234 already anticipated: there
is no status view common to every page, so stop-and-see controls, an action's result and the needs-you count
cannot ride on every page. That gap belongs to weave's contract (a weave PR), not to the templates.

## Top five, by operator impact

| # | Finding (lens) | Severity | Status |
|---|---|---|---|
| 1 | **Halt existed only on Home.** Control's Running card had no Halt. Its yolo row was read-only. Halt was a grey quiet button. (operator-control, states) | critical | **Fixed here.** Control has ■ Halt (danger, with weave's confirm) and the yolo switch. Home's Halt is a danger control. On every other page it still needs weave's status view (**weave PR 1**). |
| 2 | **On a phone, Control and Team could not be reached.** The copied CSS hid their tabs behind a More tab that does not exist. (IA, visual, operator-control) | critical | **Fixed here.** No tab is hidden; the bottom nav scrolls. |
| 3 | **Copied page CSS collided across pages.** `.row` had doubled borders on every page; `.files` muted Team's file table; `.kind`, `.bar`, `.table-wrap` and `.meter` leaked between pages. (visual) | high | **Fixed here.** Every copied page block is scoped to its view root. A test holds it (`test/review.test.ts`). |
| 4 | **Refreshes lost the operator's state.** An open `<details>` closed every 10–15 s. Text typed while a request was in flight, or in another form when an action's refresh landed, was wiped. A background poll erased an error's remedy. A dead connection looked live. (live-data, states) | high | **Fixed here** in `app.js`: edits and focus carry across swaps; details and scroll positions are kept; the error region clears only after the operator's next action; a send error or timeout says "Can't reach weave — retrying. Not updated since …" and marks the views stale; a first load that fails says so in its slot; hidden tabs do not poll; a pending form disables its buttons. |
| 5 | **No result after an action.** "Allowed.", "Budget $X — spent $Y" and the Team editor's refusals are gone, because `/ui/a` returns refreshed views and not the action's result. (states, operator-control) | high | **weave PR 2.** weave-ui is ready to render it. |

## Fixed in this PR (each through hexa, with a test where one could hold it)

- **Control:** Halt and the yolo switch.
- **Home:**
  - ■ Halt is a danger control.
  - Every Resume asks, and adds a budget warning when spend is over.
  - A halted Home shows two Resume forms, not three, and one yolo switch.
  - "All tasks" goes to `/audit?since=24h`.
  - The decisions count is no longer a link to the dropped `/knowledge`.
- **weave.css:**
  - page blocks are scoped;
  - the phone nav hides nothing;
  - weave's top-bar fleet chrome is ported (red Halt, red halted pill, violet yolo pill, inline picker, 40 px touch targets);
  - number inputs are styled;
  - `.status`/`.badge` take `data-tone="auto"`;
  - the active scope card is highlighted (`aria-current`) and no longer shows a pointer;
  - token fallbacks replace hard-coded colours.
- **panel.ts:** chart bars carry their tone on the `<meter>`.
- **app.js:** finding 4 above.
- **layout/build** (in the previous PR): an empty `/audit` asks instead of failing with bad-param.

## Deferred, with the reason

| Finding | Why it is not fixed here |
|---|---|
| **Typing in Home's chat composer still holds Home's poll.** Halt/yolo state freezes while a draft is unsent. | `test/app.test.ts` ("a typed draft holds the poll", added by an earlier hardening pass) pins the hold. Edits now survive swaps without it, but changing that test needs a reviewed decision; CLAUDE.md forbids editing a test to make a change pass. Two options for the owner: drop the hold (and that test), or make chat its own view. |
| Work's "and N more — see Activity." names a dropped page. | weave's own copy, pinned verbatim by `test/work.test.ts`. The wording change goes with a reviewed test change. |
| The needs-you badge sits on Work as well as Home; Work's "Where you can help" repeats Home's Needs you. | Faithful to weave's pages. Which list stays is the owner's call (ADR-0133). |
| "Control" mostly reads (costs, models). Nav order. The Audit/"Full record" double name. | Nav order and labels come from weave's `CORE_NAV` (`src/domain/console-api.ts`). Change them there first. |
| Fragment size is unbounded (Decided for you, Team's file bodies). Every poll re-renders even when nothing changed. | weave-side: apply the read `limit` to `/ui/f`, and answer 204 when the view hash is unchanged. Phase 3's `/ui/events` replaces the timers. |
| A stale poll can land after an action's fresh render. | Reasoned from the code, not reproduced. Needs a `data-now` ordering check and a test. |
| Failure sprays barely show. Open breakers and the usage limit are read-only. | Needs contract data (failures per agent or backend) and a breaker-reset verb in weave first. |
| Budget can only be raised, and only while halted. | Hours of work: a budget form on Control. Left for 0.1.x. |
| Dark theme: `--on-bad` on `--bad` is 3.35:1. | Copied from weave as it ships, documented in `test/tokens.test.ts`. A palette change belongs to weave's design owner. |
| No live markdown preview in the role editor; no image paste. | They need a client renderer or an image pipeline. Out of scope for templates. |

## Fine — leave alone

- The tokens and the one-colour-one-meaning palette (light and dark are tested).
- `<meter>` in place of inline-width bars.
- The `html` tag and the escaping shape test.
- Out-of-band view swaps as the update model until Phase 3.
- The audit picker as one select.
- Control, Factory, Task and Audit's markup, which matches the legacy pages.

## weave PRs this review adds to the parity record's list

1. A status view for every page: halt, yolo, `needsYou`, last-read time.
2. `/ui/a` returns the action's result, and `role`'s soft failure becomes a refusal.
3. `/ui/f` honours the read `limit`, and answers 204 when nothing changed.
4. `CORE_NAV` order and labels, decided by the owner.
5. `harness-status.ts` emits `/machines`, not `/peers`.
