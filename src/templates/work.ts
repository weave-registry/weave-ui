import type { WorkView, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { plural, time, str, num } from "../ui/format.js";
import { actionForm, actionLink } from "../ui/actions.js";

/**
 * The `work` template: weave's Work page (`/work`) as one out-of-band htmx fragment, at parity with weave's
 * work-page.ts (docs/parity/home-work-control.md, ## Work): who is working, what is left, and where you can help.
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
  const help = n0(s["help"]);

  return toHtml(
    html`<section id="view-work" class="view work" hx-get="/ui/f/work" hx-trigger="every 10s" hx-swap="none" hx-swap-oob="true" data-nav-count="work:${help}">${pageHead(s)}${whoSection(s, v["machines"], now)}${whatSection(s, v, now)}${helpSection(help, v["help"])}</section>`,
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

function slots(inUse: unknown, total: unknown): string {
  return `${n0(inUse)} of ${plural(n0(total), "slot")} in use`;
}

// ---- head ----

function pageHead(s: Rec): SafeHtml {
  const sentence = str(s["sentence"]);
  return html`<div class="page-head"><h1>Work</h1><span class="sub" id="summary">${sentence !== "" ? sentence : "Who is working, what is left, and where you can help."}</span></div>`;
}

// ---- 1. who is working ----

const AGENT_TONE: Readonly<Record<string, string>> = { working: "work", idle: "ok", paused: "needs", silent: "bad" };
const IDLE_WORD: Readonly<Record<string, string>> = { paused: "Paused", silent: "Silent" };

function whoSection(s: Rec, machines: unknown, now: number | undefined): SafeHtml {
  const rows = arr(machines).map(rec);
  const head = html`<h2 class="section" id="who-h">Who is working<span class="count"> (${slots(s["inUse"], s["slots"])})</span></h2>`;
  if (rows.length === 0) {
    return html`${head}<div class="machines" id="who"><p class="note">No machine has checked in yet. Start weave on one with: weave serve</p></div>`;
  }
  return html`${head}<div class="machines" id="who">${rows.map((m) => machineCard(m, now))}</div>`;
}

function machineCard(m: Rec, now: number | undefined): SafeHtml {
  const quiet = m["quiet"] === true;
  const idleWhy = str(m["idleWhy"]);
  const heard = quiet ? html`<div class="status" data-tone="bad">Not heard from since ${time(m["lastHeardTs"], opt(now))}</div>` : "";
  const why = idleWhy !== "" ? html`<div class="card-why">Idle: ${idleWhy}</div>` : "";
  return html`<div class="${quiet ? "card needs" : "card"}"><div class="card-title">${str(m["node"])}<span class="slots">${slots(m["inUse"], m["slots"])}</span></div>${heard}${why}${arr(m["agents"]).map((a) => agentRow(rec(a), now))}</div>`;
}

function agentRow(a: Rec, now: number | undefined): SafeHtml {
  const role = str(a["role"]);
  const doing = arr(a["doing"]).map(rec);
  const idleWhy = str(a["idleWhy"]);
  const what =
    doing.length > 0
      ? html`<ul>${doing.map((d) => {
          const model = str(d["model"]);
          return html`<li><a href="/task?id=${str(d["taskId"])}">${str(d["words"])}</a> (${time(d["sinceTs"], { ...opt(now), fmt: "dur" })}${model !== "" ? `, ${model}` : ""})</li>`;
        })}</ul>`
      : html`<div class="why">${pick(IDLE_WORD, a["state"], "Idle")}${idleWhy !== "" ? ` — ${idleWhy}` : ""}</div>`;
  return html`<div class="agent"><div class="status" data-tone="${pick(AGENT_TONE, a["state"], "")}"><span class="name">${str(a["name"])}</span>${role !== "" ? html`<span class="role"> · ${role}</span>` : ""}<span class="slots">${slots(a["inUse"], a["slots"])}</span></div>${what}</div>`;
}

// ---- 2. what is left ----

const STEP: Readonly<Record<string, string>> = {
  triage: "Triage",
  design: "Design",
  plan: "Plan",
  build: "Build",
  verify: "Verify",
  review: "Review",
  merge: "Merge",
};
const ISSUE_TONE: Readonly<Record<string, string>> = { running: "work", queued: "", waiting: "needs", held: "bad" };
const STEP_STATES = ["done", "skipped", "current", "todo"] as const;

function stepLabel(step: unknown): string {
  return pick(STEP, step, str(step));
}

function whatSection(s: Rec, v: Rec, now: number | undefined): SafeHtml {
  const issues = arr(v["issues"]).map(rec);
  const head = html`<h2 class="section" id="what-h">What is left</h2>`;
  const counts = html`<p class="counts" id="counts">${plural(n0(s["issues"]), "issue")} in progress · ${plural(n0(s["queued"]), "step")} queued · ${n0(s["merged"])} merged today</p>`;
  const body =
    issues.length > 0
      ? html`<div class="card" id="what">${issues.map((i) => issueRow(i, now))}</div>`
      : html`<div class="card" id="what"><p class="note">No issue is in the pipeline.</p></div>`;
  return html`${head}${counts}${body}<div id="other">${otherList(v["other"], v["otherMore"], now)}</div>`;
}

function issueRow(i: Rec, now: number | undefined): SafeHtml {
  const tone = pick(ISSUE_TONE, i["state"], "");
  const issue = num(i["issue"]);
  const pr = rec(i["pr"]);
  const url = str(i["url"]);
  const prLink =
    typeof i["pr"] === "object" && i["pr"] !== null ? actionLink(pr["url"], `Pull request #${num(pr["number"]) ?? str(pr["number"])}`, "btn link") : "";
  const line = arr(i["steps"]).map((c) => {
    const cell = rec(c);
    const state = STEP_STATES.find((x) => x === cell["state"]) ?? "todo";
    return html`<li data-state="${state}" data-tone="${state === "current" ? tone : ""}" title="${state}">${stepLabel(cell["step"])}</li>`;
  });
  return html`<div class="issue"><div class="head"><div class="grow"><strong>${str(i["title"])}</strong><span class="muted"> #${issue !== undefined ? String(issue) : ""}</span></div>${url !== "" ? actionLink(url, "Issue", "btn link") : ""}${prLink}</div><ol class="line">${line}</ol><div class="state" data-tone="${tone}">${stepLabel(i["step"])}: ${str(i["words"])} · ${time(i["sinceTs"], opt(now))}</div></div>`;
}

function otherList(other: unknown, more: unknown, now: number | undefined): SafeHtml {
  const rows = arr(other).map(rec);
  if (rows.length === 0) return html``;
  const n = n0(more);
  const items = rows.map(
    (t) =>
      html`<div class="issue"><a href="/task?id=${str(t["taskId"])}">${str(t["title"])}</a><div class="state" data-tone="${t["state"] === "running" ? "work" : ""}">${str(t["words"])} · ${time(t["sinceTs"], opt(now))}</div></div>`,
  );
  return html`<div class="card other"><div class="card-title">Other work</div>${items}${n > 0 ? html`<p class="muted small">and ${n} more — see Activity.</p>` : ""}</div>`;
}

// ---- 3. where you can help ----

function helpSection(count: number, help: unknown): SafeHtml {
  const cards = arr(help).map(rec);
  const head = html`<h2 class="section" id="help-h">Where you can help${count > 0 ? html`<span class="count"> (${count})</span>` : ""}</h2>`;
  if (cards.length === 0) return html`${head}<div class="help" id="help"><p class="note">Nothing needs you.</p></div>`;
  return html`${head}<div class="help" id="help">${cards.map(helpCard)}</div>`;
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

function helpCard(h: Rec): SafeHtml {
  const acts: SafeHtml[] = [];
  const main = helpAction(h["action"], true);
  if (main !== undefined) acts.push(main);
  for (const m of arr(h["more"])) {
    const b = helpAction(m, false);
    if (b !== undefined) acts.push(b);
  }
  const detail = str(h["detail"]);
  const how = str(h["how"]);
  return html`<div class="card needs" data-key="${str(h["key"])}"><div class="card-title">${str(h["title"])}</div><div class="card-why">Why you: ${str(h["why"])}</div>${detail !== "" ? html`<pre>${detail}</pre>` : ""}${acts.length > 0 ? html`<div class="actions">${acts.map((b, i) => (i === 0 ? b : html` ${b}`))}</div>` : ""}${how !== "" ? html`<details class="fix"><summary>How</summary><pre>${how}</pre></details>` : ""}</div>`;
}
