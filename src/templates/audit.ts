import type { AuditViewModel, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { money, plural, time, str, num } from "../ui/format.js";

/**
 * The `audit` template: weave's Full record (`/audit`) as one out-of-band htmx fragment, at parity with weave's
 * audit-page.ts renderReport (docs/parity/task-audit.md, ## Audit). The picker forms and the page head live in
 * the page shell; this is the summary card and the sections under it. Not polled: weave's page does not refresh.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws.
 * Pure and synchronous; `ctx` is unused.
 */
export function audit(vm: AuditViewModel, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const r = rec(v["report"]);
  const verify = rec(v["verify"]);
  return toHtml(
    html`<section id="view-audit" class="view audit" hx-swap-oob="true">${summaryCard(r, verify)}${sections(r)}</section>`,
  );
}

// ---- guards ----

type Rec = Readonly<Record<string, unknown>>;

function rec(x: unknown): Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Rec) : {};
}

function arr(x: unknown): readonly unknown[] {
  return Array.isArray(x) ? x : [];
}

function recs(x: unknown): Rec[] {
  return arr(x).map(rec);
}

function n0(x: unknown): number {
  return num(x) ?? 0;
}

function has(map: Readonly<Record<string, string>>, k: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined;
}

// ---- labels (audit-page.ts:73-88) ----

const PROBLEM: Readonly<Record<string, string>> = {
  "tool-error": "A tool call failed",
  "task-failed": "The task failed",
  "verify-failed": "Verification failed",
  "grant-expired": "An approval request expired unanswered",
  "gate:expired": "An approval request expired unanswered",
  "spend-ceiling": "Stopped at the spending limit",
  "missing-prompt-capture": "The prompt sent to the model was not recorded",
  "re-tiered": "Moved to a different model",
};

const SAID_NO: Readonly<Record<string, string>> = {
  "gate:denied-by-operator": "You denied a call",
  "grant-denied": "You denied a call",
  "task-cancelled": "You cancelled the task",
  "task-released:cancelled": "Handed back after you cancelled it",
};

const NUDGE: Readonly<Record<string, string>> = {
  "empty-answer": "It gave an empty answer; weave asked again",
  "native-refusal": "It refused; weave retried",
  "no-tool-access": "It said it had no tools; weave nudged it",
  "operator-ask": "It stopped to ask you mid-task; weave retried",
  "typed-tool-call": "It typed a tool call instead of making it; weave nudged it",
  "unbacked-claim": "It claimed something it had not done; weave nudged it",
  "uncalled-tool": "It named a tool it never called; weave nudged it",
};

const CONFLICT: Readonly<Record<string, string>> = {
  "answer-path-mismatch": "The answer names a different file than the one the agent wrote",
};

const STATUS: Readonly<Record<string, string>> = {
  completed: "Done",
  failed: "Failed",
  released: "Handed back",
  open: "Open",
  cancelled: "Stopped",
  declared: "Waiting",
  claimed: "Working",
};

// ---- formats ----

function tokens(x: unknown): string {
  const n = n0(x);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(n);
}

function span(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return Math.round(ms / 1000) + "s";
  if (m < 90) return m + "m";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}

// ---- pieces ----

function seq(n: unknown): SafeHtml {
  return html`<span class="seq">#${n0(n)}</span>`;
}

function seqs(cites: unknown): SafeHtml {
  return html`<span class="seq">${recs(cites)
    .map((c) => "#" + n0(c["seq"]))
    .join(" · ")}</span>`;
}

function taskLink(subject: unknown): SafeHtml {
  const s = str(subject);
  return html`<a href="/task?id=${s}">${s}</a>`;
}

function sub(text: string): SafeHtml {
  return html`<div class="sub">${text}</div>`;
}

const FIRST = 8;

/** A `details.sec`: rows in a card (the first eight, the rest one click away past ten), or "None.". */
function section(key: string, title: string, rows: readonly SafeHtml[], open: boolean): SafeHtml {
  const body =
    rows.length <= FIRST + 2
      ? rows
      : html`${rows.slice(0, FIRST)}<details><summary>Show ${rows.length - FIRST} more</summary>${rows.slice(FIRST)}</details>`;
  const inner = rows.length ? html`<div class="card">${body}</div>` : html`<p class="note">None.</p>`;
  return open
    ? html`<details class="sec" data-keep="${key}" open><summary>${title}</summary>${inner}</details>`
    : html`<details class="sec" data-keep="${key}"><summary>${title}</summary>${inner}</details>`;
}

// ---- summary card ----

function selTitle(x: Rec): SafeHtml | string {
  const kind = str(x["kind"]);
  if (kind === "search") return "Search “" + str(x["query"]) + "”";
  if (kind === "thread") return "Issue or conversation " + str(x["thread"]);
  if (kind === "subject") return "Task " + str(x["subject"]);
  if (kind === "workflow") return "Workflow " + str(x["instance"]);
  if (kind === "window") return html`Since ${time(x["since"], { fmt: "local" })}`;
  return "This record";
}

/** "Check this record": re-reads this selector (a window or a search pinned to its absolute bounds); a workflow has none. */
function checkButton(x: Rec): SafeHtml {
  const kind = str(x["kind"]);
  const label = "Check this record";
  if (kind === "subject") {
    return html`<button class="btn" type="button" data-audit-check hx-get="/ui/f/audit?id=${str(x["subject"])}" hx-swap="none">${label}</button>`;
  }
  if (kind === "thread") {
    return html`<button class="btn" type="button" data-audit-check hx-get="/ui/f/audit?thread=${str(x["thread"])}" hx-swap="none">${label}</button>`;
  }
  if (kind === "window") {
    return html`<button class="btn" type="button" data-audit-check hx-get="/ui/f/audit?since=${n0(x["since"])}&amp;until=${n0(x["until"])}" hx-swap="none">${label}</button>`;
  }
  if (kind === "search") {
    // Pin the window too: a bare find re-resolves its bounds from "now", and the sha covers them.
    const q = str(x["query"]);
    const hasSince = x["since"] !== undefined;
    const hasUntil = x["until"] !== undefined;
    if (hasSince && hasUntil) {
      return html`<button class="btn" type="button" data-audit-check hx-get="/ui/f/audit?find=${q}&amp;since=${n0(x["since"])}&amp;until=${n0(x["until"])}" hx-swap="none">${label}</button>`;
    }
    if (hasSince) {
      return html`<button class="btn" type="button" data-audit-check hx-get="/ui/f/audit?find=${q}&amp;since=${n0(x["since"])}" hx-swap="none">${label}</button>`;
    }
    if (hasUntil) {
      return html`<button class="btn" type="button" data-audit-check hx-get="/ui/f/audit?find=${q}&amp;until=${n0(x["until"])}" hx-swap="none">${label}</button>`;
    }
    return html`<button class="btn" type="button" data-audit-check hx-get="/ui/f/audit?find=${q}" hx-swap="none">${label}</button>`;
  }
  return html``;
}

function summaryCard(r: Rec, verify: Rec): SafeHtml {
  const s = rec(r["summary"]);
  const costs = rec(r["costs"]);
  const hexa = costs["hexa"] === undefined ? undefined : rec(costs["hexa"]);
  const wallMs = num(rec(costs["totals"])["wallMs"]);
  const failed = n0(s["failed"]);
  const open = n0(s["open"]);
  const tone = failed ? "bad" : open ? "work" : "ok";
  const line = `${plural(n0(s["tasks"]), "task")} — ${n0(s["completed"])} done, ${failed} failed, ${open} still open`;
  const cost =
    money(s["usd"]) +
    " by weave" +
    (hexa ? " + " + money(hexa["usd"]) + " by hexa" : "") +
    " · " +
    tokens(s["tokens"]) +
    " tokens" +
    (wallMs ? " · " + span(wallMs) + " of work" : "");
  const notes = arr(r["notes"])
    .filter((n): n is string => typeof n === "string")
    .map((n) => html`<div class="card-why">${n}</div>`);
  const sha = str(verify["sha256"]);
  const selector = rec(r["selector"]);
  return html`<div class="card"><div class="card-title">${selTitle(selector)}</div><div class="status" data-tone="${tone}">${line}</div><div class="card-why">${cost}</div>${notes}<div class="actions">${checkButton(selector)}<span class="result" data-audit-result role="status"></span><span class="seq" data-audit-sha="${sha}" title="${sha}">sha256 ${sha.slice(0, 16)}…</span></div></div>`;
}

// ---- sections ----

function mistakeRow(m: Rec, label: string): SafeHtml {
  const detail = str(m["detail"]);
  return html`<div class="row"><div class="grow"><span class="kind">${label}</span> · ${taskLink(m["subject"])}${detail ? sub(detail) : ""}</div>${seqs(m["cites"])}</div>`;
}

function sections(r: Rec): SafeHtml[] {
  const out: SafeHtml[] = [];
  const s = rec(r["summary"]);

  const problems: Rec[] = [];
  const nudges: Rec[] = [];
  const saidNo: Rec[] = [];
  for (const m of recs(r["mistakes"])) {
    const type = str(m["type"]);
    if (has(SAID_NO, type) !== undefined) saidNo.push(m);
    else if (type.startsWith("finding:")) nudges.push(m);
    else problems.push(m);
  }

  const models = recs(r["models"]);
  const modelOf = new Map<string, string>();
  for (const mo of models) modelOf.set(str(mo["subject"]), str(mo["resolved"]) || "backend default");

  if (Array.isArray(s["matches"])) {
    const matches = recs(s["matches"]).map(
      (x) =>
        html`<div class="row"><div class="grow">${taskLink(x["subject"])}<span class="muted"> · ${str(x["field"])} · score ${n0(x["score"]).toFixed(2)}</span>${sub(str(x["snippet"]))}</div>${seq(x["seq"])}</div>`,
    );
    out.push(section("matches", `Matches (${matches.length})`, matches, true));
  }

  out.push(
    section(
      "wrong",
      `What went wrong (${problems.length})`,
      problems.map((m) => mistakeRow(m, has(PROBLEM, str(m["type"])) ?? str(m["type"]))),
      problems.length > 0,
    ),
  );

  const contradictions = recs(r["contradictions"]);
  out.push(
    section(
      "conflicts",
      `Conflicting answers (${contradictions.length})`,
      contradictions.map((c) => {
        const type = str(c["type"]);
        return html`<div class="row"><div class="grow"><span class="kind">${has(CONFLICT, type) ?? type}</span> · ${taskLink(c["subject"])}${sub(str(c["detail"]))}</div>${seqs(c["cites"])}</div>`;
      }),
      contradictions.length > 0,
    ),
  );

  out.push(
    section(
      "corrected",
      `Weave corrected the agent (${nudges.length})`,
      nudges.map((m) => {
        const type = str(m["type"]);
        return mistakeRow(m, has(NUDGE, type.split(":")[1] ?? "") ?? type);
      }),
      false,
    ),
  );

  out.push(
    section(
      "said-no",
      `You said no to (${saidNo.length})`,
      saidNo.map((m) => mistakeRow(m, has(SAID_NO, str(m["type"])) ?? "")),
      false,
    ),
  );

  const tasks = recs(r["tasks"]);
  out.push(
    section(
      "tasks",
      `Tasks (${tasks.length})`,
      tasks.map((t) => {
        const subject = str(t["subject"]);
        const status = str(t["status"]);
        const model = modelOf.get(subject);
        const origin = str(t["origin"]);
        return html`<div class="row" data-task="${subject}"><div class="grow">${taskLink(subject)}<span class="muted"> · ${has(STATUS, status) ?? status}${model ? " · " + model : ""}</span>${origin ? sub(origin) : ""}</div>${seq(t["seq"])}</div>`;
      }),
      true,
    ),
  );

  const costs = rec(r["costs"]);
  const costRows = recs(costs["rows"]).map(
    (c) =>
      html`<div class="row"><div class="grow">${str(c["subject"])}<span class="muted"> · ${str(c["model"])} · ${tokens(c["tokens"])} tokens${c["measured"] === true ? "" : " · estimated"}</span></div><span class="num">${money(c["usd"])}</span>${seq(c["seq"])}</div>`,
  );
  const hexaRows =
    costs["hexa"] === undefined
      ? []
      : recs(rec(costs["hexa"])["rows"]).map(
          (h) =>
            html`<div class="row"><div class="grow">${str(h["subject"])}<span class="muted"> · ${str(h["tool"])} · hexa, ${plural(n0(h["calls"]), "call")}</span></div><span class="num">${money(h["usd"])}</span>${seq(h["seq"])}</div>`,
        );
  out.push(section("cost", "Cost", [...costRows, ...hexaRows], false));

  out.push(
    section(
      "models",
      `Models (${models.length})`,
      models.map((mo) => {
        const backend = str(mo["backend"]);
        return html`<div class="row"><div class="grow">${str(mo["subject"])}<span class="muted"> · ${str(mo["resolved"]) || "backend default"}${backend ? " on " + backend : ""} · ${str(mo["reason"])}</span></div>${seq(mo["seq"])}</div>`;
      }),
      false,
    ),
  );

  const prompts = recs(r["prompts"]);
  out.push(
    section(
      "prompts",
      `What each agent was sent (${prompts.length})`,
      prompts.map((p) => {
        const system = typeof p["system"] === "string" ? p["system"] : null;
        const sys =
          system === null
            ? sub("System prompt: not recorded (declared before it was captured).")
            : html`<details><summary>System prompt (${system.length} characters)</summary><pre class="goal">${system}</pre></details>`;
        const tools = Array.isArray(p["tools"])
          ? sub(
              "Tools offered: " +
                (arr(p["tools"])
                  .filter((t): t is string => typeof t === "string")
                  .join(", ") || "none"),
            )
          : "";
        const goal = str(p["goal"]);
        return html`<div class="row"><div class="grow"><div class="kind">${str(p["subject"])} · attempt ${n0(p["attempt"])}</div>${sys}${tools}<details><summary>The request as sent (${goal.length} characters)</summary><pre class="goal">${goal}</pre></details></div>${seq(p["seq"])}</div>`;
      }),
      false,
    ),
  );

  const mem = rec(r["memory"]);
  const memRows: SafeHtml[] = [
    ...recs(mem["grounding"]).map((g) => {
      const recalled = arr(g["recalled"]).length;
      return html`<div class="row"><div class="grow">${str(g["subject"])}: ${plural(arr(g["notes"]).length, "note")}${recalled ? `, ${recalled} recalled` : ""}</div>${seq(g["seq"])}</div>`;
    }),
    ...recs(mem["calls"]).map(
      (c) =>
        html`<div class="row"><div class="grow">${str(c["subject"])}: ${str(c["tool"])}${c["isError"] === true ? " (failed)" : ""}${sub(str(c["args"]) + " ⇒ " + str(c["output"]))}</div>${seq(c["seq"])}</div>`,
    ),
    ...recs(mem["events"]).map(
      (m) =>
        html`<div class="row"><div class="grow">${str(m["kind"])} by ${str(m["actor"])}${sub(str(m["text"]))}</div>${seq(m["seq"])}</div>`,
    ),
    ...recs(mem["summaries"]).map(
      (m) =>
        html`<div class="row"><div class="grow">Summary of ${str(m["thread"])}${sub(str(m["text"]))}</div>${seq(m["seq"])}</div>`,
    ),
  ];
  if (memRows.length) out.push(section("memory", `Memory (${memRows.length})`, memRows, false));

  const order = rec(r["order"]);
  const steps = recs(order["rows"]);
  const stepRows = steps.map((o) => {
    const detail = str(o["detail"]);
    return html`<div class="row">${seq(o["seq"])}<div class="grow"><span class="kind">${str(o["kind"])}</span> · ${str(o["subject"])} · ${str(o["actor"])}${detail ? sub(detail) : ""}</div><span class="seq">${time(o["ts"], { fmt: "time" })}</span></div>`;
  });
  const omitted = recs(order["omitted"]).map((od) => {
    const kinds = rec(od["kinds"]);
    const ks = Object.keys(kinds).map((k) => `${n0(kinds[k])} ${k}`);
    return html`<p class="note">Not listed on ${str(od["subject"])}: ${ks.join(", ")} (#${n0(od["from"])}–#${n0(od["to"])}).</p>`;
  });
  out.push(section("steps", `Every step (${steps.length})`, [...stepRows, ...omitted], false));

  return out;
}
