import type { FactoryBoardView, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, safeUrl, type SafeHtml } from "../html.js";
import { money, plural, time, stageName, stageVerb, toolPhrase, str, num } from "../ui/format.js";
import { actionForm, attentionActions } from "../ui/actions.js";

/**
 * The `factory` template: weave's Factory page (`/factory`, served by the factory plugin) as one out-of-band htmx
 * fragment, at parity with weave's factory-page.ts (docs/parity/factory-machines-team.md, ## Factory).
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws.
 * Pure and synchronous; `ctx` is unused.
 */
export function factory(vm: FactoryBoardView, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const sv = rec(v["supervisor"]);
  const autonomous = sv["autonomous"] === true;
  const rows = arr(v["board"]).map(rec);
  const completed = rows.filter((r) => isObj(r["completed"]));
  const live = rows
    .filter((r) => !isObj(r["completed"]))
    .map((r, i) => ({ r, i, n: actionCount(r, autonomous) }))
    .sort((a, b) => Number(b.n > 0) - Number(a.n > 0) || a.i - b.i);
  const k = live.filter((x) => x.n > 0).length;

  return toHtml(
    html`<section id="view-factory" class="view factory" hx-get="/ui/f/factory" hx-trigger="every 10s" hx-swap="none" hx-swap-oob="true">${pageHead(live.length, k, completed.length, v["backlog"])}${yoloCard(v["yolo"])}${supervisorCard(v["supervisor"])}${newForm()}${backlogSection(v["backlog"])}${issuesSection(live.map((x) => x.r), completed, k, autonomous)}</section>`,
  );
}

function pageHead(live: number, k: number, c: number, backlog: unknown): SafeHtml {
  const backlogSpan = isObj(backlog) ? html`<span><b>${arr(rec(backlog)["issues"]).length}</b> in the backlog</span>` : "";
  return html`<div class="page-head"><h1>Factory</h1><div class="stats"><span><b>${live}</b> in the pipeline</span><span>${k > 0 ? html`<b class="needs">${k}</b>` : html`<b>${k}</b>`} need you</span><span>${c > 0 ? html`<b class="ok">${c}</b>` : html`<b>${c}</b>`} completed</span>${backlogSpan}</div></div>`;
}

// ---- guards ----

type Rec = Readonly<Record<string, unknown>>;

function isObj(x: unknown): boolean {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function rec(x: unknown): Rec {
  return isObj(x) ? (x as Rec) : {};
}

function arr(x: unknown): readonly unknown[] {
  return Array.isArray(x) ? x : [];
}

function n0(x: unknown): number {
  return num(x) ?? 0;
}

const HTTP = /^https?:\/\//i;

/** A plain link: an absolute http(s) URL opens in a new tab; anything else goes through safeUrl. */
function link(href: string, label: string): SafeHtml {
  return HTTP.test(href)
    ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : html`<a href="${safeUrl(href)}">${label}</a>`;
}

function history(issue: unknown): SafeHtml {
  return html`<a href="/audit?thread=factory:${String(num(issue) ?? str(issue))}">History</a>`;
}

// ---- stages ----

const MARK: Readonly<Record<string, string>> = { done: "✓", running: "…", queued: "…", waiting: "⏳", failed: "✗", cancelled: "–" };
const FACTORY_STAGES = ["triage", "intent", "design", "plan", "build", "verify", "ship", "review", "close"] as const;

function mark(state: string): string {
  return Object.prototype.hasOwnProperty.call(MARK, state) ? (MARK[state] ?? "") : "";
}

/** 'claude-opus-5-5' → 'opus 5.5', 'claude-sonnet-5' → 'sonnet 5'; anything else unchanged. */
function shortModel(m: string): string {
  const x = /^claude-([a-z]+)-(.+)$/.exec(m);
  return x ? `${x[1] ?? ""} ${(x[2] ?? "").replace(/-/g, ".")}` : m;
}

function busy(r: Rec): Rec | undefined {
  return arr(r["stages"])
    .map(rec)
    .find((s) => s["state"] === "running" || s["state"] === "queued" || s["state"] === "waiting");
}

/** The stage the issue's NEXT line suggests, and whatever the stage said after it. */
function suggested(r: Rec): { stage: string; note: string } | undefined {
  const m = /^factory:([a-z]+)\s*[—–-]?\s*([\s\S]*)$/.exec(str(r["next"]));
  const stage = m?.[1] ?? "";
  return m && (FACTORY_STAGES as readonly string[]).includes(stage) ? { stage, note: m[2] ?? "" } : undefined;
}

function pending(r: Rec): Rec[] {
  return arr(r["pending"]).map(rec);
}

/** Whether the issue offers Start: weave's actionsFor() start-block rule. */
function startable(r: Rec, autonomous: boolean): { stage: string; note: string } | undefined {
  const next = suggested(r);
  return next && !autonomous && busy(r) === undefined && pending(r).length === 0 ? next : undefined;
}

function actionCount(r: Rec, autonomous: boolean): number {
  return pending(r).length + (startable(r, autonomous) ? 1 : 0);
}

// ---- 1. yolo card ----

function yoloPick(): SafeHtml {
  return html`<select name="for" class="yolo-pick" aria-label="For how long"><option value="1h">1 hour</option><option value="4h">4 hours</option><option value="8h" selected>8 hours</option><option value="24h">1 day</option><option value="72h">3 days</option></select>`;
}

function yoloCard(y: unknown): SafeHtml | "" {
  if (!isObj(y)) return "";
  const yo = rec(y);
  let line: SafeHtml;
  let control: SafeHtml;
  if (yo["on"] === true) {
    const user = str(yo["user"]);
    const by = str(yo["by"]);
    const reason = str(yo["reason"]);
    const exp = yo["expiresAt"];
    line = html`On — ${time(exp, { fmt: "until" })} left · turned on by ${user !== "" ? `${user} via ${by}` : by}${reason !== "" ? `: ${reason}` : ""}${num(exp) !== undefined ? html` · until ${time(exp, { fmt: "local" })}` : ""}`;
    control = actionForm({ yolo: { off: true } }, { label: "Turn yolo off" });
  } else {
    const ended = yo["ended"];
    const why =
      ended === "expired"
        ? html` — it expired ${time(yo["endedAt"])}`
        : ended === "halt"
          ? " — a halt ended it"
          : ended === "off"
            ? " — turned off"
            : "";
    const env = yo["set"] !== true && rec(yo["grants"])["factory"] === true ? " · this host's FACTORY_AUTONOMOUS still runs the factory until the switch is first used" : "";
    line = html`Off${why}${env}`;
    control = actionForm({ yolo: { on: true } }, { label: "Turn yolo on", extra: yoloPick() });
  }
  return html`<section class="card" id="yolo"><div class="card-title">Yolo mode</div><div class="status" data-tone="${yo["on"] === true ? "work" : "idle"}">${line}</div><div class="actions">${control}</div><details class="more"><summary>What yolo does</summary><div class="card-why">While it is on, the factory advances and re-runs stages, small, evidenced factory pull requests merge themselves (within the cap), and fleet requests (install, start, stop, roles) run without your Approve. It turns itself off when the time is up, or at any halt. Except a stage${"'"}s own gate commands and what the chief of staff approves inside its hard floor, parked grants and the guard still wait for you.</div></details></section>`;
}

// ---- 2. supervisor card ----

function supervisorCard(x: unknown): SafeHtml | "" {
  if (!isObj(x)) return "";
  const sv = rec(x);
  const all = arr(sv["problems"]).map(rec);
  const problems = all.filter((p) => p["severity"] !== "watch");
  const inHand = all.filter((p) => p["severity"] === "watch");
  const advanced = arr(sv["advanced"]).map(rec);
  const autonomous = sv["autonomous"] === true;
  const held = str(sv["held"]);
  const every = String(n0(sv["everyS"]));
  const last = num(sv["lastScanTs"]);
  const status: SafeHtml =
    held !== ""
      ? html`${`Waiting — the model's usage limit is reached (${held}); nothing new starts until it passes`}`
      : autonomous
        ? html`${`On — advances each stage's NEXT every ${every} s`}${last !== undefined ? html` · last looked ${time(last)}` : ` · first look within ${every} s`}`
        : html`Off — each stage waits for you to press Advance. Turn yolo mode on above to let it carry the pipeline (FACTORY_AUTONOMOUS=1 is the old, per-host way).`;
  const tone = problems.length > 0 ? "bad" : autonomous ? "ok" : "idle";
  const decisions =
    problems.length > 0
      ? html`<div>${problems.map(problemBlock)}</div>`
      : html`<div class="card-why">Nothing needs you.</div>`;
  const hand =
    inHand.length > 0
      ? html`<details><summary>In hand (${inHand.length})</summary><ul>${inHand.map(
          (p) =>
            html`<li>${str(p["title"])} ${arr(p["actions"])
              .map(rec)
              .filter((a) => typeof a["href"] === "string")
              .map((a) => link(str(a["href"]), str(a["label"])))}</li>`,
        )}</ul></details>`
      : "";
  const adv =
    advanced.length > 0
      ? html`<details><summary>Recent advances (${advanced.length})</summary><ul>${advanced.map(
          (a) =>
            html`<li>#${String(num(a["issue"]) ?? str(a["issue"]))} → ${str(a["stage"])}${a["ok"] === true ? "" : ` — failed: ${str(a["error"])}`} · ${time(a["ts"])}</li>`,
        )}</ul></details>`
      : "";
  return html`<section class="card" id="supervisor"><div class="card-title">Supervisor</div><div class="status" data-tone="${tone}">${status}${problems.length > 0 ? ` · ${plural(problems.length, "decision")} for you` : ""}</div>${decisions}${hand}${adv}</section>`;
}

function problemBlock(p: Rec): SafeHtml {
  const acts = arr(p["actions"]);
  const body =
    acts.length > 0
      ? html`<div class="actions">${attentionActions(acts)}</div>`
      : html`<details class="fix"><summary>How to fix</summary><pre>${str(p["action"])}</pre></details>`;
  return html`<div class="ask-block"><div class="kind">${str(p["title"])}</div><div class="card-why">${str(p["detail"])}</div>${body}</div>`;
}

// ---- 3. start new work ----

function newForm(): SafeHtml {
  return html`<form class="card" id="new-form" hx-post="/ui/a/factoryNew" hx-swap="none"><div class="card-title">Start new work</div><div class="card-why">Say what you want built or fixed. Weave opens an issue for it and the factory takes it from there — triage, plan, build, verify, ship, review. Anything permanent waits for you here first.</div><div class="new-fields"><input name="title" maxlength="200" aria-label="Title" placeholder="What should be done? e.g. Add a dark mode to the settings page" required><textarea name="body" rows="3" maxlength="8000" aria-label="Details" placeholder="Details, if any: why, where, what done looks like"></textarea></div><div class="actions"><button class="btn primary" type="submit">Start</button></div></form>`;
}

// ---- 4. backlog ----

function backlogSection(x: unknown): SafeHtml | "" {
  const b = rec(x);
  const issues = arr(b["issues"]).map(rec);
  if (issues.length === 0) return "";
  const repo = str(b["repo"]);
  return html`<section id="backlog"><details class="card"><summary>Backlog — not started (${issues.length})</summary><div class="card-why">Open issues on ${repo} the factory has not picked up. Start one to send it to triage.</div><ul>${issues.map((i) => backlogItem(i, repo))}</ul></details></section>`;
}

function backlogItem(i: Rec, repo: string): SafeHtml {
  const n = num(i["number"]);
  const ref = `#${n !== undefined ? String(n) : ""}`;
  const url = str(i["url"]);
  const title = str(i["title"]);
  const go =
    n !== undefined
      ? actionForm(
          { factory: HTTP.test(url) ? { issue: n, stage: "triage", title, url, repo } : { issue: n, stage: "triage", title, repo } },
          { label: "Start", tone: "quiet" },
        )
      : "";
  return html`<li>${HTTP.test(url) ? link(url, ref) : ref} ${title} ${go}</li>`;
}

// ---- 5. issues ----

function issuesSection(live: readonly Rec[], completed: readonly Rec[], k: number, autonomous: boolean): SafeHtml {
  const count = k > 0 ? html`<span class="count"> (${k} need${k === 1 ? "s" : ""} you)</span>` : "";
  const note = k === 1 ? "One issue needs you — it's first below." : k > 1 ? `${k} issues need you — they're first below.` : "Nothing needs you right now.";
  const done =
    completed.length > 0
      ? html`<details class="card"><summary>Completed (${completed.length})</summary><ul>${completed.map(
          (r) => html`<li>#${String(num(r["issue"]) ?? "")} ${str(r["title"])} · ${history(r["issue"])}</li>`,
        )}</ul></details>`
      : "";
  const body =
    live.length > 0
      ? html`${live.map((r) => issueCard(r, autonomous))}${done}`
      : completed.length > 0
        ? done
        : html`<p class="empty">No work yet. Start some above — or open an issue on the forge; either way triage starts on its own.</p>`;
  return html`<h2 class="section" id="needs-h">Issues${count}</h2><p class="note" id="needs">${note}</p><div id="issues">${body}</div>`;
}

function status(r: Rec, autonomous: boolean): [string, string] {
  const b = busy(r);
  if (pending(r).length > 0) return ["needs", `Waiting for you — ${stageName(str(b?.["stage"]))} needs your approval`];
  if (b) return ["work", stageName(str(b["stage"])) + (b["state"] === "queued" ? " — queued, waiting for a free slot" : " is working…")];
  const hold = rec(r["reviewHold"]);
  const next = suggested(r);
  if (isObj(r["reviewHold"]) && (hold["handoff"] === true || (hold["sameHead"] === true && next))) {
    return [hold["handoff"] === true ? "needs" : "ok", str(hold["text"])];
  }
  if (next) return autonomous ? ["work", `Ready for ${stageName(next.stage)} — the supervisor starts it`] : ["needs", `Ready for ${stageName(next.stage)}`];
  const rest = str(r["next"]).replace(/^none\s*[—–-]?\s*/i, "");
  return rest !== "" ? ["ok", `Finished — ${rest}`] : ["ok", "Finished"];
}

function runsLine(r: Rec): SafeHtml | "" {
  const n = rec(r["runs"]);
  const total = n0(n["total"]);
  if (total === 0) return "";
  const chip = (count: number, word: string, tone: string): SafeHtml | "" =>
    count !== 0 ? html`<span class="chip" data-tone="${tone}">${count} ${word}</span>` : "";
  return html`<div class="runs"><span class="num">${plural(total, "run")}: </span>${chip(n0(n["done"]), "done", "ok")}${chip(n0(n["open"]), "running", "work")}${chip(n0(n["failed"]), "failed", "bad")}${chip(n0(n["cancelled"]), "cancelled", "idle")}</div>`;
}

function grantBlock(r: Rec, g: Rec): SafeHtml {
  const stage = arr(r["stages"])
    .map(rec)
    .find((s) => typeof g["taskId"] === "string" && s["taskId"] === g["taskId"]);
  const who = stage ? stageName(str(stage["stage"])) : "A stage";
  const tool = str(g["tool"]);
  const detail = str(g["detail"]) || tool;
  const id = str(g["requestId"]);
  return html`<div class="ask-block"><div class="kind">${who} ${toolPhrase(tool)}</div><pre>${detail.replace(/^\$ /, "")}</pre><div class="actions">${actionForm({ grant: { approve: id } }, { label: "Allow", tone: "primary" })}${actionForm({ grant: { deny: id } }, { label: "Deny", tone: "quiet" })}</div></div>`;
}

function startBlock(r: Rec, next: { stage: string; note: string }): SafeHtml {
  const name = stageName(next.stage);
  const issue = num(r["issue"]);
  const go = issue !== undefined ? actionForm({ factoryAdvance: { issue } }, { label: `Start ${name}` }) : "";
  return html`<div class="ask-block"><div class="card-why">${name} will ${stageVerb(next.stage)}.${next.note !== "" ? ` The last stage said: ${next.note}` : ""}</div><div class="actions">${go}</div></div>`;
}

function step(s: Rec): SafeHtml {
  const stage = str(s["stage"]);
  const state = str(s["state"]);
  const model = str(s["model"]);
  const from = str(s["escalatedFrom"]);
  const routed = str(s["routedBy"]);
  const title = `${stageName(stage)}: ${stageVerb(stage)} · ${state}${model !== "" ? ` · ${model}` : ""}${routed !== "" ? ` · ${routed}` : ""}`;
  const m = model !== "" ? html`<span class="model"> ${shortModel(model)}${from !== "" ? ` ↑ from ${shortModel(from)}` : ""}</span>` : "";
  return html`<li class="step" data-state="${state}" title="${title}">${stageName(stage)} ${mark(state)}${m}</li>`;
}

function issueCard(r: Rec, autonomous: boolean): SafeHtml {
  const [tone, text] = status(r, autonomous);
  const start = startable(r, autonomous);
  const acts: SafeHtml[] = pending(r).map((g) => grantBlock(r, g));
  if (start) acts.push(startBlock(r, start));
  const url = str(r["url"]);
  const hexa = n0(r["hexaUsd"]);
  const foot = html`<div class="card-foot">${HTTP.test(url) ? link(url, "Open issue") : ""}${history(r["issue"])}<span class="end num">spent ${money(r["usd"])}${hexa !== 0 ? ` + hexa ${money(hexa)}` : ""}</span></div>`;
  return html`<div class="${acts.length > 0 ? "card needs" : "card"}"><div class="card-title">#${String(num(r["issue"]) ?? "")} ${str(r["title"])}</div><div class="status" data-tone="${tone}">${text}</div>${runsLine(r)}${acts}<ol class="trail">${arr(r["stages"]).map((s) => step(rec(s)))}</ol>${foot}</div>`;
}
