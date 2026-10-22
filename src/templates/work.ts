import type { WorkView, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { time, str, num } from "../ui/format.js";
import { actionForm, actionLink } from "../ui/actions.js";

/**
 * The `work` template: weave's Work page (`/work`) as one out-of-band htmx fragment, redesigned
 * (docs/plans/2026-10-23-redesign-spec.md, ## Work): a head of stats, the pipeline as a stage-column board of issue
 * cards, then — below — where you can help, who is working (a slot strip per machine), and other work.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws.
 * Pure and synchronous; `ctx` is unused.
 */
export function work(vm: WorkView, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const now = num(v["now"]);
  const s = rec(v["summary"]);

  return toHtml(
    html`<section id="view-work" class="view work" hx-get="/ui/f/work" hx-trigger="every 10s" hx-swap="none" hx-swap-oob="true">${pageHead(s)}${board(v["issues"], now)}<div class="work-lower">${helpSection(n0(s["help"]), v["help"])}${whoSection(s, v["machines"], now)}${otherSection(v["other"], v["otherMore"], now)}</div></section>`,
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

function n0(x: unknown): number {
  return num(x) ?? 0;
}

function opt(now: number | undefined): { now?: number } {
  return now !== undefined ? { now } : {};
}

/** The value of `k` in a fixed table, or `fallback` when `k` is not one of its own keys. */
function pick(table: Readonly<Record<string, string>>, k: unknown, fallback: string): string {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(table, k) ? (table[k] ?? fallback) : fallback;
}

// ---- head ----

function pageHead(s: Rec): SafeHtml {
  return html`<div class="page-head"><h1>Work</h1><div class="stats"><span><b>${n0(s["issues"])}</b> in progress</span><span><b>${n0(s["queued"])}</b> queued</span><span><b class="ok">${n0(s["merged"])}</b> merged today</span><span><b>${n0(s["inUse"])} / ${n0(s["slots"])}</b> slots busy</span></div></div>`;
}

// ---- the board ----

const STEP: Readonly<Record<string, string>> = {
  triage: "Triage",
  design: "Design",
  plan: "Plan",
  build: "Build",
  verify: "Verify",
  review: "Review",
  merge: "Merge",
};
const STEPS = ["triage", "design", "plan", "build", "verify", "review", "merge"] as const;
const ISSUE_STATE: Readonly<Record<string, string>> = { running: "Running", queued: "Queued", waiting: "Waiting", held: "Held" };

function board(issues: unknown, now: number | undefined): SafeHtml {
  const rows = arr(issues).map(rec);
  const stepOf = (i: Rec): string => (typeof i["step"] === "string" && Object.prototype.hasOwnProperty.call(STEP, i["step"]) ? i["step"] : "triage");
  const cols = STEPS.map((step) => {
    const mine = rows.filter((i) => stepOf(i) === step);
    return html`<div class="col" data-step="${step}"><div class="col-head"><span class="col-name">${STEP[step] ?? step}</span><span class="col-count num">${mine.length}</span></div>${mine.map((i) => issueCard(i, now))}</div>`;
  });
  return html`<section class="panel board" aria-label="Pipeline"><div class="board-cols">${cols}</div>${rows.length === 0 ? html`<p class="empty">No issue is in the pipeline.</p>` : ""}</section>`;
}

function issueCard(i: Rec, now: number | undefined): SafeHtml {
  const state = Object.prototype.hasOwnProperty.call(ISSUE_STATE, str(i["state"])) ? str(i["state"]) : "queued";
  const issue = num(i["issue"]);
  const url = str(i["url"]);
  const title = str(i["title"]);
  const pr = rec(i["pr"]);
  const prPart =
    typeof i["pr"] === "object" && i["pr"] !== null && !Array.isArray(i["pr"])
      ? html`<a href="${str(pr["url"])}">PR #${num(pr["number"]) ?? str(pr["number"])}</a>`
      : html`<span>no PR</span>`;
  return html`<div class="wcard" data-state="${state}"><div class="wcard-top"><span class="wcard-id num">#${issue !== undefined ? String(issue) : ""}</span><span class="state" data-state="${state}">${pick(ISSUE_STATE, state, "Queued")}</span></div><div class="wcard-title">${url !== "" ? html`<a href="${url}">${title}</a>` : title}</div><div class="wcard-note">${str(i["words"])}</div><div class="wcard-foot">${prPart}<span class="wcard-age">${time(i["sinceTs"], opt(now))}</span></div></div>`;
}

// ---- where you can help ----

function helpSection(count: number, help: unknown): SafeHtml {
  const rows = arr(help).map(rec);
  const head = html`<div class="panel-head"><h2 id="help-h">Where you can help</h2><span class="pill" data-tone="${count > 0 ? "needs" : "ok"}">${count}</span></div>`;
  const body = rows.length > 0 ? html`<div class="lrows">${rows.map(helpRow)}</div>` : html`<p class="empty">Nothing needs you.</p>`;
  return html`<section class="panel" id="help" aria-labelledby="help-h">${head}${body}</section>`;
}

function helpAction(x: unknown, primary: boolean): SafeHtml | undefined {
  const a = rec(x);
  if (typeof a["label"] !== "string") return undefined;
  const label = a["label"];
  const body = a["body"];
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const tone = primary ? "primary" : "quiet";
    const confirm = a["confirm"];
    return actionForm(rec(body), typeof confirm === "string" ? { label, tone, confirm } : { label, tone });
  }
  if (typeof a["href"] === "string") return actionLink(a["href"], label, primary ? "btn primary" : "btn");
  return undefined;
}

function helpRow(h: Rec): SafeHtml {
  const acts: SafeHtml[] = [];
  const main = helpAction(h["action"], true);
  if (main !== undefined) acts.push(main);
  for (const m of arr(h["more"])) {
    const b = helpAction(m, false);
    if (b !== undefined) acts.push(b);
  }
  const title = str(h["title"]);
  const detail = str(h["detail"]);
  const how = str(h["how"]);
  return html`<div class="lrow" data-key="${str(h["key"])}"><div class="lrow-main"><div class="lrow-title" title="${title}">${title}</div><div class="lrow-why">${str(h["why"])}</div></div><div class="lrow-acts">${acts.map((b, i) => (i === 0 ? b : html` ${b}`))}</div>${detail !== "" ? html`<details class="lrow-more"><summary>Details</summary><pre>${detail}</pre></details>` : ""}${how !== "" ? html`<details class="lrow-more"><summary>How</summary><pre>${how}</pre></details>` : ""}</div>`;
}

// ---- who is working ----

const IDLE_WORD: Readonly<Record<string, string>> = { paused: "Paused", silent: "Silent" };

function whoSection(s: Rec, machines: unknown, now: number | undefined): SafeHtml {
  const rows = arr(machines).map(rec);
  const head = html`<div class="panel-head"><h2 id="who-h">Who is working</h2><span class="panel-link">${n0(s["inUse"])} of ${n0(s["slots"])} slots busy</span></div>`;
  const body =
    rows.length > 0 ? rows.map((m) => slotHost(m, now)) : html`<p class="empty">No machine has checked in yet. Start weave on one with: weave serve</p>`;
  return html`<section class="panel" id="who" aria-labelledby="who-h">${head}<div class="panel-body">${body}</div></section>`;
}

function slotHost(m: Rec, now: number | undefined): SafeHtml {
  const quiet = m["quiet"] === true;
  const agents = arr(m["agents"]).map(rec);
  const idleWhy = str(m["idleWhy"]);
  const status = quiet
    ? html`<span class="muted">Not heard from since ${time(m["lastHeardTs"], opt(now))}</span>`
    : html`<span class="muted">${n0(m["inUse"])} / ${n0(m["slots"])}</span>`;
  const cells = agents.map((a) => {
    const doing = arr(a["doing"]).map(rec);
    const inUse = n0(a["inUse"]);
    const total = Math.max(0, Math.min(1000, Math.floor(n0(a["slots"]))));
    return Array.from({ length: total }, (_, k) => {
      if (k >= inUse) return html`<span class="slot"></span>`;
      const d = doing[k];
      return html`<span class="slot" data-busy="true" title="${d !== undefined ? str(d["words"]) : str(a["name"])}"></span>`;
    });
  });
  const lines = agents.map((a) => {
    const name = str(a["name"]);
    const doing = arr(a["doing"]).map(rec).map((d) => {
      const model = str(d["model"]);
      return html`<div class="slot-doing"><a href="/task?id=${str(d["taskId"])}">${str(d["words"])}</a> <span class="muted">${name} · ${model !== "" ? `${model} · ` : ""}${time(d["sinceTs"], { ...opt(now), fmt: "dur" })}</span></div>`;
    });
    const why = str(a["idleWhy"]);
    const idle =
      a["state"] === "paused" || a["state"] === "silent"
        ? html`<div class="slot-doing muted">${name}: ${pick(IDLE_WORD, a["state"], "")}${why !== "" ? ` — ${why}` : ""}</div>`
        : "";
    return html`${doing}${idle}`;
  });
  return html`<div class="slot-host" data-quiet="${quiet ? "true" : "false"}"><div class="slot-head"><span class="dot" data-tone="${quiet ? "bad" : "ok"}"></span><b>${str(m["node"])}</b>${status}</div><div class="slots">${cells.flat()}</div>${lines}${idleWhy !== "" ? html`<div class="slot-doing muted">Idle: ${idleWhy}</div>` : ""}</div>`;
}

// ---- other work ----

function otherSection(other: unknown, more: unknown, now: number | undefined): SafeHtml {
  const rows = arr(other).map(rec);
  if (rows.length === 0) return html``;
  const n = n0(more);
  const items = rows.map(
    (t) =>
      html`<div class="lrow"><span class="dot" data-tone="${t["state"] === "running" ? "work" : ""}"></span><div class="lrow-main"><div class="lrow-title"><a href="/task?id=${str(t["taskId"])}">${str(t["title"])}</a></div><div class="lrow-why">${str(t["words"])}</div></div><span class="lrow-meta">${time(t["sinceTs"], opt(now))}</span></div>`,
  );
  return html`<section class="panel" id="other" aria-labelledby="other-h"><div class="panel-head"><h2 id="other-h">Other work</h2></div><div class="lrows">${items}</div>${n > 0 ? html`<p class="empty"><a href="/audit?since=24h">and ${n} more</a></p>` : ""}</section>`;
}
