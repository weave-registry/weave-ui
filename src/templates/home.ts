import type { HomeViewModel, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { money, plural, time, stageName, stageVerb, toolPhrase, str, num } from "../ui/format.js";
import { actionForm, actionLink, attentionActions } from "../ui/actions.js";
import { markdown } from "../markdown.js";
import { panel } from "../ui/panel.js";

/**
 * The `home` template: weave's Home page (`/`), redesigned (docs/plans/2026-10-23-redesign.md; markup in
 * docs/plans/2026-10-23-redesign-spec.md, ## Components and ## Home), as one out-of-band htmx fragment: the health
 * banner, the KPI strip, Needs you as dense rows with filter chips, the side column (machines, autonomy, control
 * plane), the lower row (working now, done recently, decided for you, Ask weave), then the sidebar's out-of-band
 * fragments (#side-net, #nav-meta-<key>, #side-foot, then Machines' #host-telemetry and #model-drift; decision 4), which follow the section with nothing between.
 *
 * Halt and resume are never posted (ADR-0245 §3): actionForm renders {fleet:"halt"|"resume"} as its CLI command.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws.
 * Pure and synchronous; `ctx` is unused.
 */
export function home(vm: HomeViewModel, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const now = num(v["now"]);
  const needs = arr(v["needs"]).map(rec);
  const needsCount = needs.filter((n) => n["severity"] === "needs-you").length;
  const status = rec(v["status"]);
  const facts = rec(status["facts"]);
  const work = rec(v["work"]);
  const resumeAsk = resumeConfirm(facts);

  return toHtml(
    html`<section id="view-home" class="view home" hx-get="/ui/f/home" hx-trigger="every 10s" hx-swap="none" hx-swap-oob="true" data-needs-count="${needsCount}"><h1 class="sr-only">Home</h1>${healthBanner(v["status"], resumeAsk)}${kpis(needs, needsCount, work, facts)}<div class="home-grid">${needsPanel(needs, needsCount, now, resumeAsk)}<aside class="home-side">${machinesPanel(facts, work)}${autonomyPanel(status, now)}${controlPanel(facts, now)}</aside></div><div class="home-lower"><div class="home-col">${workingPanel(v["working"], v["queued"], now)}${donePanel(v["done"], now)}${decidedPanel(v["decided"], now)}</div>${chatAside(v["chat"], now)}</div></section>${sidebarFragments(status, facts, work, needsCount, now)}`,
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

function strs(x: unknown): string[] {
  return arr(x).filter((s): s is string => typeof s === "string");
}

function n0(x: unknown): number {
  return num(x) ?? 0;
}

function opt(now: number | undefined): { now?: number } {
  return now !== undefined ? { now } : {};
}

function present(x: Rec): boolean {
  return Object.keys(x).length > 0;
}

/** SafeHtml items with `sep` between them. */
function joined(items: readonly SafeHtml[], sep: string): SafeHtml {
  return html`${items.map((x, i) => (i === 0 ? x : html`${sep}${x}`))}`;
}

// ---- shared controls ----

const VERDICTS = ["halted", "degraded", "working", "idle"] as const;
type Verdict = (typeof VERDICTS)[number];

function verdictOf(s: Rec): Verdict {
  return VERDICTS.find((x) => x === s["verdict"]) ?? "idle";
}

const RESUME_CONFIRM = "Resume the fleet? Peers start claiming and spending again.";
const RESUME_OVER = " The fleet is over its budget; a budget halt comes back while the spend is still over.";

/** Whether a command body is {fleet:'resume'}. */
function isResume(body: unknown): boolean {
  return rec(body)["fleet"] === "resume";
}

/** The Resume confirm; it warns when the spend is over the budget (from the harness facts). */
function resumeConfirm(facts: Rec): string {
  const spend = rec(facts["spend"]);
  return present(spend) && n0(spend["fraction"]) >= 1 ? `${RESUME_CONFIRM}${RESUME_OVER}` : RESUME_CONFIRM;
}

function yoloPick(): SafeHtml {
  return html`<select name="for" class="yolo-pick" aria-label="For how long"><option value="1h">1 hour</option><option value="4h">4 hours</option><option value="8h" selected>8 hours</option><option value="24h">1 day</option><option value="72h">3 days</option></select>`;
}

function yoloForm(label: string, confirm?: string): SafeHtml {
  const extra = yoloPick();
  return actionForm({ yolo: { on: true } }, confirm !== undefined ? { label, confirm, extra } : { label, extra });
}

/** The budget as weave shows it: a whole number of dollars as "$25", else money. */
function budgetText(budget: number): string {
  return Number.isInteger(budget) ? `$${budget}` : money(budget);
}

function spendHours(spend: Rec): number {
  return Math.round(n0(spend["windowMs"]) / 3_600_000);
}

function spendMeter(spend: Rec): SafeHtml {
  const pct = Math.round(n0(spend["fraction"]) * 100);
  const tone = pct >= 100 ? "bad" : pct >= 90 ? "needs" : "ok";
  return html`<meter class="bar" min="0" max="100" value="${Math.min(100, Math.max(0, pct))}" data-tone="${tone}" aria-label="Spend against the budget"></meter>`;
}

// ---- health banner ----

const QUIET_REASONS = new Set(["yolo-off", "needs-you", "nothing-queued"]);

function titleCase(w: string): string {
  return w === "" ? "" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/** A reason's control (Phase 2's harnessReason): a command form, the yolo-on form, or a link; '' for none. */
function reasonControl(r: Rec, resumeAsk: string): SafeHtml | "" {
  const fix = rec(r["fix"]);
  const label = str(fix["label"]);
  const confirm = typeof fix["confirm"] === "string" ? fix["confirm"] : undefined;
  if (fix["kind"] === "command") {
    const body = rec(fix["body"]);
    const ask = confirm ?? (isResume(body) ? resumeAsk : undefined);
    return actionForm(body, ask !== undefined ? { label, confirm: ask } : { label });
  }
  if (fix["kind"] === "yolo") return yoloForm(label, confirm);
  if (fix["kind"] === "link") return actionLink(fix["href"], label, "btn");
  return "";
}

function healthBanner(status: unknown, resumeAsk: string): SafeHtml | "" {
  if (typeof status !== "object" || status === null || Array.isArray(status)) return "";
  const s = rec(status);
  const verdict = verdictOf(s);
  const reasons = arr(s["reasons"])
    .map(rec)
    .filter((r) => !QUIET_REASONS.has(str(r["key"])));
  if (verdict !== "halted" && verdict !== "degraded" && reasons.length === 0) return "";
  const word = titleCase(str(s["word"]) !== "" ? str(s["word"]) : verdict);
  const first = reasons[0];
  const title = first !== undefined ? html`<span class="health-word">${word}</span> — ${str(first["text"])}` : html`<span class="health-word">${word}</span>`;
  const more =
    reasons.length > 1
      ? html`<ul class="health-more">${reasons.slice(1).map((r) => html`<li class="health-reason" data-key="${str(r["key"])}"><span class="grow">${str(r["text"])}</span>${reasonControl(r, resumeAsk)}</li>`)}</ul>`
      : "";
  const control = first !== undefined ? reasonControl(first, resumeAsk) : "";
  const act = control !== "" ? html`<div class="health-act">${control}</div>` : "";
  return html`<div class="health" data-verdict="${verdict}" role="status" aria-label="Harness status"><span class="health-icon" aria-hidden="true"></span><div class="health-main"><div class="health-title">${title}</div><div class="health-sub">${str(s["sentence"])}</div>${more}</div>${act}</div>`;
}

// ---- categories ----

const CATEGORIES = ["factory", "decisions", "fleet", "release", "grant", "plan", "autonomy", "other"] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  factory: "Factory",
  decisions: "Decisions",
  fleet: "Fleet",
  release: "Release",
  grant: "Grant",
  plan: "Plan",
  autonomy: "Autonomy",
  other: "Other",
};
const FLEET_KEYS = ["breaker", "provider", "host", "reconcile", "peer", "halt", "budget"];

/** A need's category, from its kind, else its key (an optional leading "attention:" removed). */
function categoryOf(n: Rec): Category {
  const kind = n["kind"];
  if (kind === "grant") return "grant";
  if (kind === "stage") return "factory";
  if (kind === "plan") return "plan";
  if (kind === "halt") return "fleet";
  const raw = str(n["key"]);
  const key = raw.startsWith("attention:") ? raw.slice("attention:".length) : raw;
  if (key.startsWith("factory") || key.startsWith("stage")) return "factory";
  if (key.startsWith("release") || key.startsWith("rollout")) return "release";
  if (FLEET_KEYS.some((k) => key.startsWith(k))) return "fleet";
  if (key.startsWith("decision")) return "decisions";
  if (key.startsWith("yolo")) return "autonomy";
  return "other";
}

function tagTone(cat: Category, needsYou: boolean): string {
  if (!needsYou) return "";
  if (cat === "fleet") return "bad";
  if (cat === "decisions" || cat === "plan") return "work";
  if (cat === "autonomy") return "auto";
  return "needs";
}

/** Each category present among `needs` with its count, in category order. */
function categoryCounts(needs: readonly Rec[]): { cat: Category; count: number }[] {
  const counts = new Map<Category, number>();
  for (const n of needs) {
    const c = categoryOf(n);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return CATEGORIES.filter((c) => counts.has(c)).map((cat) => ({ cat, count: counts.get(cat) ?? 0 }));
}

// ---- KPI strip ----

function kpi(href: string, tone: string, label: string, value: string | number, sub: string): SafeHtml {
  return html`<a class="kpi" href="${href}" data-tone="${tone}"><span class="kpi-label">${label}</span><span class="kpi-value num">${value}</span><span class="kpi-sub">${sub}</span></a>`;
}

function kpis(needs: readonly Rec[], needsCount: number, work: Rec, facts: Rec): SafeHtml {
  const breakdown = categoryCounts(needs.filter((n) => n["severity"] === "needs-you"))
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .slice(0, 3)
    .map((x) => `${x.count} ${x.cat}`)
    .join(" · ");
  const sum = rec(work["summary"]);
  const inUse = n0(sum["inUse"]);
  const queued = n0(sum["queued"]);
  const failed = n0(facts["failed24h"]);
  const total = n0(facts["done24h"]) + failed;
  const failedSub = total > 0 ? `of ${total} tasks · ${Math.round((100 * failed) / total)}%` : "no tasks settled";
  return html`<div class="kpis" aria-label="Summary">${[
    kpi("#needs-h", needsCount > 0 ? "needs" : "ok", "Needs you", needsCount, breakdown !== "" ? breakdown : "nothing waiting"),
    kpi("/work", inUse > 0 ? "work" : "", "Running", `${inUse} / ${n0(sum["slots"])}`, `slots busy on ${plural(n0(sum["machines"]), "machine")}`),
    kpi("/work", "work", "In progress", n0(sum["issues"]), queued > 0 ? `issues · ${queued} queued` : "issues · nothing queued"),
    kpi("/work", "ok", "Merged today", n0(sum["merged"]), "pull requests"),
    kpi("/audit?since=24h", failed > 0 ? "bad" : "", "Failed 24h", failed, failedSub),
  ]}</div>`;
}

// ---- needs you ----

const CLOSE_CONFIRM = (issue: string): string => `Close #${issue}? Its open stages are cancelled, and an issue on the forge is closed there.`;

function needsPanel(needs: readonly Rec[], count: number, now: number | undefined, resumeAsk: string): SafeHtml {
  const pill = html`<span class="pill" data-tone="${count > 0 ? "needs" : "ok"}">${count}</span>`;
  const open = html`<section class="panel needs" id="needs" aria-labelledby="needs-h" data-filter-scope="needs">`;
  if (needs.length === 0) {
    return html`${open}<div class="panel-head"><h2 id="needs-h">Needs you</h2>${pill}</div><p class="empty">Nothing needs you right now.</p></section>`;
  }
  const chips = categoryCounts(needs).map(
    (x) => html`<button type="button" class="chip" data-filter="${x.cat}" aria-pressed="false">${CATEGORY_LABELS[x.cat]} ${x.count}</button>`,
  );
  return html`${open}<div class="panel-head"><h2 id="needs-h">Needs you</h2>${pill}<div class="chips" role="group" aria-label="Filter Needs you"><button type="button" class="chip" data-filter="all" aria-pressed="true">All ${needs.length}</button>${chips}</div></div><div class="lrows">${needs.map((n) => needRow(n, now, resumeAsk))}</div></section>`;
}

interface RowParts {
  readonly title: string;
  readonly code?: SafeHtml | "";
  readonly why?: SafeHtml | "";
  readonly acts: SafeHtml | "";
  readonly more?: SafeHtml | "";
}

function needRow(n: Rec, now: number | undefined, resumeAsk: string): SafeHtml {
  const kind = n["kind"];
  let parts: RowParts;
  if (kind === "grant") parts = grantRow(n, now);
  else if (kind === "stage") parts = stageRow(n);
  else if (kind === "plan" && typeof n["plan"] === "object" && n["plan"] !== null) parts = planRow(n);
  else if (kind === "halt") parts = haltRow(n, resumeAsk);
  else parts = attentionRow(n);
  const cat = categoryOf(n);
  const needsYou = n["severity"] === "needs-you";
  const why = parts.why !== undefined && parts.why !== "" ? html`<div class="lrow-why">${parts.why}</div>` : "";
  return html`<div class="lrow" data-key="${str(n["key"])}" data-cat="${cat}" data-sev="${needsYou ? "needs-you" : "watch"}"><span class="tag" data-tone="${tagTone(cat, needsYou)}">${CATEGORY_LABELS[cat]}</span><div class="lrow-main"><div class="lrow-title" title="${parts.title}">${parts.title}</div>${parts.code ?? ""}${why}</div><span class="lrow-meta">${time(n["askedTs"], opt(now))}</span><div class="lrow-acts">${parts.acts}</div>${parts.more ?? ""}</div>`;
}

function grantRow(n: Rec, now: number | undefined): RowParts {
  const task = str(n["task"]);
  const id = str(n["grantId"]);
  const call = strs(n["call"]);
  const expires = num(n["expiresTs"]);
  return {
    title: `${task !== "" ? task : "A task"} ${toolPhrase(n["tool"])}`,
    code: call.length > 0 ? html`<code class="lrow-code">${call.join(" · ")}</code>` : "",
    why: expires !== undefined ? html`denied by silence ${time(expires, { ...opt(now), fmt: "until" })}` : "",
    acts: html`${actionForm({ grant: { approve: id } }, { label: "Allow" })} ${actionForm({ grant: { deny: id } }, { label: "Deny", tone: "quiet" })}`,
  };
}

function stageRow(n: Rec): RowParts {
  const issue = num(n["issue"]) ?? 0;
  const stage = str(n["stage"]);
  const name = stageName(stage);
  const note = str(n["note"]);
  return {
    title: `#${issue} ${str(n["title"])} — ready for ${name}`,
    why: html`${name} will ${stageVerb(stage)}.${note !== "" ? ` Last stage: ${note}` : ""}`,
    acts: html`${actionForm({ factoryAdvance: { issue } }, { label: `Start ${name}` })} ${actionForm({ factoryClose: { issue } }, { label: "Close", tone: "quiet", confirm: CLOSE_CONFIRM(String(issue)) })} ${actionLink("/factory", "Factory", "btn link")}`,
  };
}

function planStep(step: Rec, i: number): SafeHtml {
  const cost = num(step["costUsd"]);
  const costLine = cost !== undefined ? html`<div class="card-why">about ${money(cost)}</div>` : "";
  const what =
    step["kind"] === "factory"
      ? html`<span class="badge" data-tone="work">factory</span> <strong>${str(step["title"])}</strong><div class="card-why">${str(step["body"])}</div>`
      : html`<span class="badge">${str(step["role"])}</span> <span>${str(step["goal"])}</span>`;
  return html`<label class="plan-step"><input type="checkbox" name="steps:num[]" value="${i}" checked><div class="grow">${what}${costLine}</div></label>`;
}

function planRole(role: Rec): SafeHtml {
  return html`<label class="plan-step"><input type="checkbox" name="roles:str[]" value="${str(role["name"])}"><div class="grow"><span class="badge" data-tone="needs">new role</span> <strong>${str(role["name"])}</strong> — ${str(role["purpose"])}<div class="card-why">Why: ${str(role["why"])} · Tools: ${strs(role["tools"]).join(", ")}</div></div></label>`;
}

function planRow(n: Rec): RowParts {
  const plan = rec(n["plan"]);
  const id = str(plan["id"]);
  const task = str(n["task"]);
  const extra = html`<div class="plan-steps">${arr(plan["steps"]).map((s, i) => planStep(rec(s), i))}${arr(plan["roles"]).map((r) => planRole(rec(r)))}</div>`;
  return {
    title: `The chief of staff proposes: ${str(plan["summary"])}`,
    why: task !== "" ? html`For: <a href="/task?id=${str(plan["request"])}">${task}</a>` : "",
    acts: actionForm({ plan: { decline: id } }, { label: "Decline", tone: "quiet" }),
    more: html`<div class="lrow-more">${actionForm({ plan: { accept: id } }, { label: "Start ticked", extra })}</div>`,
  };
}

function haltRow(n: Rec, resumeAsk: string): RowParts {
  const usd = html`<input type="number" name="usd:num" min="0" step="5" placeholder="$ per day" aria-label="New budget in dollars per day" required>`;
  return {
    title: str(n["title"]),
    acts: html`${actionForm({ fleet: "resume" }, { label: "Resume", confirm: resumeAsk })} ${actionForm({ budget: {} }, { label: "Raise budget", tone: "quiet", extra: usd })}`,
  };
}

function attentionRow(n: Rec): RowParts {
  const detail = str(n["detail"]);
  const who = str(n["whoDecides"]);
  const action = str(n["action"]);
  const hasActions = arr(n["actions"]).length > 0;
  const why: SafeHtml[] = [];
  if (detail !== "") why.push(html`${detail}`);
  if (who !== "") why.push(html`<span class="who" data-tone="${who.startsWith("Yolo") ? "auto" : "needs"}">${who}</span>`);
  return {
    title: str(n["title"]),
    why: why.length > 0 ? joined(why, " · ") : "",
    acts: hasActions ? attentionActions(n["actions"]) : "",
    more: action !== "" ? html`<details class="lrow-more"><summary>${hasActions ? "Details" : "How to fix"}</summary><pre>${action}</pre></details>` : "",
  };
}

// ---- side column ----

function hbar(label: string, value: number, tone: string, aria: string): SafeHtml {
  return html`<div class="hbar"><span class="hbar-label">${label}</span><meter class="bar" min="0" max="100" value="${value}" data-tone="${tone}" aria-label="${aria}"></meter><span class="hbar-val num">${value}%</span></div>`;
}

function pct(x: number): number {
  return Math.min(100, Math.max(0, Math.round(x)));
}

function machinesPanel(facts: Rec, work: Rec): SafeHtml {
  const hosts = rec(facts["hosts"]);
  const agentsOn = new Map<string, number>();
  for (const m of arr(work["machines"]).map(rec)) agentsOn.set(str(m["node"]), arr(m["agents"]).length);
  const up = arr(facts["machines"])
    .map(rec)
    .map((m) => {
      const node = str(m["node"]);
      const cpus = n0(m["cpus"]);
      const cpu = cpus > 0 ? pct((100 * n0(m["load1"])) / cpus) : 0;
      const memAvail = num(m["memAvailablePct"]);
      const mem = memAvail !== undefined ? pct(100 - memAvail) : undefined;
      const gpu = typeof m["gpu"] === "object" && m["gpu"] !== null ? rec(m["gpu"]) : undefined;
      const agents = agentsOn.get(node);
      return html`<div class="host"><div class="host-head"><span class="dot" data-tone="ok"></span><span class="host-name">${node}</span>${agents !== undefined ? html`<span class="host-meta num">${plural(agents, "agent")}</span>` : ""}</div>${hbar("CPU", cpu, cpu >= 85 ? "bad" : cpu >= 60 ? "needs" : "ok", `${node} CPU load`)}${mem !== undefined ? hbar("Mem", mem, mem >= 90 ? "bad" : "work", `${node} memory in use`) : ""}${gpu !== undefined ? hbar("GPU", pct(n0(gpu["utilPct"])), "work", `${node} GPU load`) : ""}</div>`;
    });
  const down = strs(hosts["down"]).map(
    (node) => html`<div class="host"><div class="host-head"><span class="dot" data-tone="bad"></span><span class="host-name">${node}</span><span class="host-meta">not heard</span></div></div>`,
  );
  const link = present(hosts) ? html`<a class="panel-link" href="/machines">${n0(hosts["up"])} of ${n0(hosts["total"])} up →</a>` : "";
  const body = up.length + down.length > 0 ? html`${up}${down}` : html`<p class="empty">No machine reports telemetry.</p>`;
  return html`<section class="panel" aria-labelledby="hosts-h"><div class="panel-head"><h2 id="hosts-h">Machines</h2>${link}</div><div class="panel-body">${body}</div></section>`;
}

function autonomyPanel(status: Rec, now: number | undefined): SafeHtml {
  const facts = rec(status["facts"]);
  const at = opt(now);
  const yolo = rec(facts["yolo"]);
  let yoloRow: SafeHtml;
  if (yolo["on"] === true) {
    const until = num(yolo["until"]);
    yoloRow = html`<div class="switch-row"><div class="grow"><div class="switch-name">Yolo</div><div class="switch-sub">${until !== undefined ? html`Ends ${time(until, { ...at, fmt: "until" })}` : "On"}</div></div><span class="fleet-controls" data-on="true">${actionForm({ yolo: { off: true } }, { label: "Turn yolo off", buttonClass: "switch" })}</span></div>`;
  } else {
    const since = num(yolo["offSince"]);
    const reason = arr(status["reasons"])
      .map(rec)
      .find((r) => r["key"] === "yolo-off");
    const confirm = rec(reason?.["fix"])["confirm"];
    yoloRow = html`<div class="switch-row"><div class="grow"><div class="switch-name">Yolo</div><div class="switch-sub">Off${since !== undefined ? html` since ${time(since, at)}` : ""}</div></div><span class="fleet-controls" data-on="false">${yoloForm("Turn on", typeof confirm === "string" ? confirm : undefined)}</span></div>`;
  }

  const chief = rec(facts["chief"]);
  let chiefRow: SafeHtml | "" = "";
  if (present(chief)) {
    const on = chief["on"] === true;
    const why = str(chief["why"]);
    const sub = on ? `${plural(n0(chief["actsLastHour"]), "act")} in the last hour` : `Off${why !== "" ? ` (${why})` : ""}`;
    chiefRow = html`<div class="switch-row"><div class="grow"><div class="switch-name">Chief of staff</div><div class="switch-sub">${sub}</div></div><span class="dot" data-tone="${on ? "ok" : ""}" role="img" aria-label="${on ? "on" : "off"}"></span></div>`;
  }

  const spend = rec(facts["spend"]);
  let spendBlock: SafeHtml | "" = "";
  if (present(spend)) {
    const budget = n0(spend["budgetUsd"]);
    const frees = num(spend["freesAt"]);
    spendBlock =
      budget > 0
        ? html`<div class="spend"><div class="spend-head"><span>Spend ${spendHours(spend)}h</span><span class="num">${money(spend["usd"])} / ${budgetText(budget)}</span></div>${spendMeter(spend)}${frees !== undefined ? html`<div class="switch-sub">frees up ${time(frees, at)}</div>` : ""}</div>`
        : html`<div class="spend"><div class="spend-head"><span>Spend ${spendHours(spend)}h</span><span class="num">${money(spend["usd"])} · no ceiling</span></div></div>`;
  }

  const autonomy = rec(facts["autonomy"]);
  let level: SafeHtml | "" = "";
  if (present(autonomy)) {
    const hrs = Math.round(n0(autonomy["windowMs"]) / 360000) / 10;
    let text = "autonomy standard";
    if (autonomy["level"] === "full") {
      text =
        autonomy["on"] === true
          ? `autonomy full — ${plural(n0(autonomy["merges"]), "merge")} in ${hrs}h of cap ${n0(autonomy["cap"])}`
          : "autonomy full (off until yolo is on)";
    }
    level = html`<ul class="facts"><li>${text}</li></ul>`;
  }

  return html`<section class="panel" aria-labelledby="auto-h"><div class="panel-head"><h2 id="auto-h">Autonomy</h2></div><div class="panel-body">${yoloRow}${chiefRow}${spendBlock}${level}</div></section>`;
}

function controlPanel(f: Rec, now: number | undefined): SafeHtml {
  const at = opt(now);
  const out: SafeHtml[] = [];

  const cp = rec(f["controlPlane"]);
  const peers = n0(cp["peers"]);
  const behind = arr(cp["behind"]).map(rec);
  let pill: SafeHtml | "" = "";
  if (peers > 0) {
    pill =
      behind.length > 0
        ? html`<span class="pill" data-tone="needs">${behind.length} behind</span>`
        : html`<span class="pill" data-tone="ok">in sync ${n0(cp["inSync"])}/${peers}</span>`;
    if (behind.length > 0) {
      const who = behind.map((b) => `${str(b["agent"])} (${str(b["difference"])})`).join(", ");
      out.push(html`${behind.length} of ${plural(peers, "peer")} behind — ${who}`);
    }
  }

  const models = arr(f["modelSources"]).map(rec);
  if (models.length > 0) {
    out.push(html`${plural(models.length, "model setting")} ${models.length > 1 ? "differ" : "differs"}: ${models.map((m) => str(m["setting"])).join(", ")}`);
  }

  const breakers = rec(f["breakers"]);
  if (present(breakers) && (n0(breakers["open"]) > 0 || breakers["agree"] !== true)) {
    out.push(
      html`${plural(n0(breakers["open"]), "breaker")} open${breakers["agree"] === true ? "" : ` — ${strs(breakers["disagree"]).join(", ")} sees it differently`}`,
    );
  }

  const raft = rec(f["controlRaft"]);
  if (raft["mode"] === "off") {
    out.push(html`Raft: off — log mode`);
  } else if (raft["mode"] === "shadow") {
    const divergent = arr(raft["divergent"])
      .map(rec)
      .map((d) => ` — ${str(d["node"])} differs for ${n0(d["forSec"])} s`)
      .join("");
    const frozen = arr(raft["frozen"])
      .map(rec)
      .map((z) => ` · frozen on ${str(z["node"])}`)
      .join("");
    out.push(html`Raft (shadow): ${n0(raft["agree"])}/${n0(raft["hosts"])} hosts agree${divergent}${frozen}`);
  }

  const usage = rec(f["usageLimit"]);
  if (present(usage)) {
    const until = num(usage["until"]);
    const lanes = strs(usage["lanes"]);
    const remedy = str(usage["remedy"]);
    out.push(
      html`<strong>Claude account at its usage limit</strong>${until !== undefined ? html` until ${time(until, { ...at, fmt: "local" })}` : ""}${lanes.length > 0 ? ` — failing over to ${lanes.join(", ")}` : ` — ${remedy !== "" ? remedy : "no lane to fail over to"}`}`,
    );
  }

  const rc = rec(f["reconcile"]);
  if (present(rc)) {
    const last = num(rc["lastTs"]);
    const why = str(rc["why"]);
    if (last !== undefined) {
      out.push(html`Reconciled ${time(last, at)} · ${plural(n0(rc["findings"]), "drift finding")} · ${n0(rc["fixed"])} fixed · ${n0(rc["left"])} left`);
    } else {
      out.push(html`${rc["on"] === true ? "Reconciler on · no pass yet" : `Reconciler off${why !== "" ? ` (${why})` : ""}`}`);
    }
  }

  const backlog = num(f["backlog"]);
  if (backlog !== undefined) out.push(html`<a href="/factory">${plural(backlog, "issue")} not started on the forge</a>`);

  const dec = rec(f["decisions"]);
  if (present(dec)) {
    out.push(html`${n0(dec["open"])} open decisions (${n0(dec["proposed"])} proposed · ${n0(dec["acceptedOpen"])} accepted, not complete)`);
  }

  const churn = rec(f["churn"]);
  if (n0(churn["stages"]) > 0) {
    out.push(html`factory: ${n0(churn["perStage"])} retries per stage (24h) · ${plural(n0(churn["diverged"]), "branch-diverged failure")}`);
  }

  const retired = strs(rec(f["hosts"])["retired"]);
  if (retired.length > 0) out.push(html`${plural(retired.length, "retired node id")}`);

  const list = out.length > 0 ? html`<ul class="facts">${out.map((x) => html`<li>${x}</li>`)}</ul>` : "";
  const review = typeof f["control"] === "string" ? html`<a class="panel-link" href="${f["control"]}">Review drift →</a>` : "";
  return html`<section class="panel" aria-labelledby="cp-h"><div class="panel-head"><h2 id="cp-h">Control plane</h2>${pill}</div><div class="panel-body">${list}${review}</div></section>`;
}

// ---- lower row ----

function workingPanel(working: unknown, queued: unknown, now: number | undefined): SafeHtml {
  const rows = arr(working).map(rec);
  const q = n0(queued);
  const head = html`<div class="panel-head"><h2 id="working-h">Working now</h2><span class="pill" data-tone="${rows.length > 0 ? "work" : ""}">${rows.length}</span></div>`;
  const items = rows.map((w) => {
    const id = str(w["taskId"]);
    const title = str(w["title"]);
    const agent = str(w["agent"]);
    const stop = actionForm(
      { cancel: id },
      { label: "Stop", buttonClass: "btn link", confirm: `Stop "${title}"? The worker aborts; what it did so far is kept.` },
    );
    return html`<div class="lrow"><div class="lrow-main"><div class="lrow-title"><a href="/task?id=${id}">${title}</a></div>${agent !== "" ? html`<div class="lrow-why">by ${agent}</div>` : ""}</div><span class="lrow-meta">${time(w["sinceTs"], opt(now))}</span><div class="lrow-acts">${stop}</div></div>`;
  });
  let body: SafeHtml;
  if (rows.length === 0 && q === 0) body = html`<p class="empty">Nothing is running.</p>`;
  else
    body = html`${rows.length > 0 ? html`<div class="lrows">${items}</div>` : ""}${q > 0 ? html`<p class="empty">${plural(q, "task")} waiting for a worker.</p>` : ""}`;
  return html`<section class="panel" id="working" aria-labelledby="working-h">${head}${body}</section>`;
}

const DONE_TONES: Readonly<Record<string, string>> = { done: "ok", failed: "bad", cancelled: "" };

function donePanel(done: unknown, now: number | undefined): SafeHtml {
  const rows = arr(done).map(rec);
  const head = html`<div class="panel-head"><h2 id="done-h">Done recently</h2><a class="panel-link" href="/audit?since=24h">All tasks</a></div>`;
  if (rows.length === 0) return html`<section class="panel" id="done" aria-labelledby="done-h">${head}<p class="empty">Nothing has finished yet.</p></section>`;
  const items = rows.map((d) => {
    const state = d["state"] === "failed" ? "failed" : d["state"] === "cancelled" ? "cancelled" : "done";
    const summary = str(d["summary"]);
    const why = state === "failed" ? `Failed: ${summary}` : summary;
    return html`<div class="lrow"><span class="dot" data-tone="${DONE_TONES[state] ?? ""}" role="img" aria-label="${state}"></span><div class="lrow-main"><div class="lrow-title"><a href="/task?id=${str(d["taskId"])}">${str(d["title"])}</a></div>${summary !== "" ? html`<div class="lrow-why">${why}</div>` : ""}</div><span class="lrow-meta">${time(d["ts"], opt(now))}</span></div>`;
  });
  return html`<section class="panel" id="done" aria-labelledby="done-h">${head}<div class="lrows">${items}</div></section>`;
}

function decidedPanel(decided: unknown, now: number | undefined): SafeHtml {
  const rows = arr(decided).map(rec);
  const head = html`<div class="panel-head"><h2 id="decided-h">Decided for you</h2><span class="pill" data-tone="">${rows.length}</span><span class="panel-link">last 24 h</span></div>`;
  if (rows.length === 0) {
    return html`<section class="panel" id="decided" aria-labelledby="decided-h">${head}<p class="empty">Nothing was decided for you in the last 24 hours.</p></section>`;
  }
  const items = rows.map((d) => {
    const why = str(d["why"]);
    return html`<div class="lrow"><span class="tag" data-tone="auto">${str(d["by"])}</span><div class="lrow-main"><div class="lrow-title">${str(d["what"])}</div>${why !== "" ? html`<div class="lrow-why">${why}</div>` : ""}</div><span class="lrow-meta">${time(d["ts"], opt(now))} · <a href="${str(d["href"])}">Audit</a></span></div>`;
  });
  return html`<section class="panel" id="decided" aria-labelledby="decided-h">${head}<div class="lrows">${items}</div></section>`;
}

// ---- ask weave ----

function chatAside(chat: unknown, now: number | undefined): SafeHtml {
  const turns = arr(chat).map(rec);
  const reset = actionForm(
    { chat: { reset: true } },
    {
      label: "New conversation",
      buttonClass: "btn link",
      confirm: "Start a new conversation? Weave stops carrying this one into its answers; it stays in the record.",
    },
  );
  const log =
    turns.length > 0
      ? turns.map((t) => chatTurn(t, now))
      : html`<p class="muted">Ask anything — what the fleet is doing, or work you want done.</p>`;
  return html`<aside class="chat panel" id="chat-panel" aria-label="Ask weave"><div class="chat-head"><h2>Ask weave</h2> ${reset}</div><div class="chat-log" id="chat-log" data-keep-scroll>${log}</div><form class="composer" hx-post="/ui/a/chat" hx-swap="none"><textarea name="text" rows="2" placeholder="Ask a question or describe work to do" aria-label="Ask weave" data-enter-submits required></textarea><div class="actions"><span class="hint">Enter sends · Shift+Enter for a new line. Anything permanent comes to Needs you first.</span><button class="btn primary" type="submit">Send</button></div></form></aside>`;
}

// ---- sidebar fragments (out of band) ----

const NET_TONES: Readonly<Record<Verdict, string>> = { halted: "bad", degraded: "bad", working: "ok", idle: "" };

function sidebarFragments(status: Rec, facts: Rec, work: Rec, needsCount: number, now: number | undefined): SafeHtml {
  const verdict = verdictOf(status);
  const word = str(status["word"]) !== "" ? str(status["word"]).toLowerCase() : verdict;
  const hosts = rec(facts["hosts"]);
  const versions = strs(hosts["versions"]);
  const net = html`<div id="side-net" hx-swap-oob="innerHTML"><span class="dot" data-tone="${NET_TONES[verdict]}"></span><span class="net-main"><span class="net-name">weave</span><span class="net-sub">${versions.length > 0 ? `${versions.join(", ")} · ` : ""}${word}</span></span></div>`;

  const navHome = needsCount > 0 ? html`<span class="pill" data-tone="needs">${needsCount}</span>` : "";
  const navWork = html`<span class="count">${n0(rec(work["summary"])["issues"])}</span>`;
  const held = arr(work["issues"])
    .map(rec)
    .filter((i) => i["state"] === "held").length;
  const navFactory = held > 0 ? html`<span class="count" data-tone="bad">${held} held</span>` : "";
  const up = n0(hosts["up"]);
  const total = n0(hosts["total"]);
  const navMachines = present(hosts) ? html`<span class="count" data-tone="${up === total ? "ok" : "bad"}">${up}/${total}</span>` : "";
  const agents = rec(facts["agents"]);
  const navTeam = present(agents) ? html`<span class="count">${n0(agents["live"])}</span>` : "";
  const settings = arr(facts["modelSources"]).length;
  const behind = arr(rec(facts["controlPlane"])["behind"]).length;
  const drift: string[] = [];
  if (settings > 0) drift.push(`${plural(settings, "setting")} ${settings > 1 ? "differ" : "differs"}`);
  if (behind > 0) drift.push(`${plural(behind, "peer")} behind`);
  const navControl = drift.length > 0 ? html`<span class="dot" data-tone="needs" role="img" aria-label="${drift.join(" · ")}"></span>` : "";

  const yolo = rec(facts["yolo"]);
  const until = num(yolo["until"]);
  const yoloRow =
    yolo["on"] === true
      ? html`<div class="side-row"><span class="dot" data-tone="needs"></span><span class="side-yolo" data-on="true">Yolo on</span>${until !== undefined ? html`<span class="side-end">${time(until, { ...opt(now), fmt: "until" })}</span>` : ""}</div>`
      : html`<div class="side-row"><span class="dot"></span><span class="side-yolo" data-on="false">Yolo off</span></div>`;
  const spend = rec(facts["spend"]);
  const budget = n0(spend["budgetUsd"]);
  const spendRow =
    budget > 0
      ? html`<div class="side-spend"><div class="side-row"><span>Spend ${spendHours(spend)}h</span><span class="side-end num">${money(spend["usd"])} / ${budgetText(budget)}</span></div>${spendMeter(spend)}</div>`
      : "";
  const halt = verdict === "halted" ? html`<span class="side-halted">■ Fleet halted</span>` : actionForm({ fleet: "halt" }, { label: "Halt", tone: "danger" });

  return html`${net}<span id="nav-meta-home" hx-swap-oob="innerHTML">${navHome}</span><span id="nav-meta-work" hx-swap-oob="innerHTML">${navWork}</span><span id="nav-meta-factory" hx-swap-oob="innerHTML">${navFactory}</span><span id="nav-meta-machines" hx-swap-oob="innerHTML">${navMachines}</span><span id="nav-meta-team" hx-swap-oob="innerHTML">${navTeam}</span><span id="nav-meta-control" hx-swap-oob="innerHTML">${navControl}</span><div id="side-foot" hx-swap-oob="innerHTML">${yoloRow}${spendRow}<div class="side-halt">${halt}</div></div>${telemetryFragment(facts, work)}${driftFragment(facts)}`;
}

function stat(label: string, value: string, tone: string, sub: string): SafeHtml {
  return html`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value num" data-tone="${tone}">${value}</div><div class="stat-sub">${sub}</div></div>`;
}

/** Machines' per-host telemetry tiles (#host-telemetry): load, memory, slots. */
function telemetryFragment(facts: Rec, work: Rec): SafeHtml {
  const slotsOn = new Map<string, Rec>();
  for (const m of arr(work["machines"]).map(rec)) slotsOn.set(str(m["node"]), m);
  const tiles = arr(facts["machines"])
    .map(rec)
    .map((m) => {
      const node = str(m["node"]);
      const cpus = n0(m["cpus"]);
      const load = n0(m["load1"]);
      const ratio = cpus > 0 ? load / cpus : 0;
      const memAvail = num(m["memAvailablePct"]);
      const mem = memAvail !== undefined ? 100 - memAvail : undefined;
      const gpu = typeof m["gpu"] === "object" && m["gpu"] !== null;
      const w = slotsOn.get(node);
      const slots = w !== undefined ? `${n0(w["inUse"])} / ${n0(w["slots"])}` : "—";
      return html`<div class="tele panel"><div class="tele-head"><span class="dot" data-tone="ok"></span><b>${node}</b><span class="tele-spec">${plural(cpus, "core")}${gpu ? " · GPU" : ""}</span></div><div class="tele-stats">${stat("Load", String(load), ratio >= 0.85 ? "bad" : ratio >= 0.6 ? "needs" : "ok", `of ${plural(cpus, "core")}`)}${stat("Memory", mem !== undefined ? `${mem}%` : "—", mem !== undefined && mem >= 90 ? "bad" : "", "in use")}${stat("Slots", slots, "", "busy")}</div></div>`;
    });
  return html`<div id="host-telemetry" hx-swap-oob="innerHTML">${tiles}</div>`;
}

/** Machines' model-setting drift table (#model-drift): one column per gateway, empty when nothing differs. */
function driftFragment(facts: Rec): SafeHtml {
  const models = arr(facts["modelSources"]).map(rec);
  if (models.length === 0) return html`<div id="model-drift" hx-swap-oob="innerHTML"></div>`;
  const gateways: string[] = [];
  for (const m of models) {
    for (const val of arr(m["values"]).map(rec)) {
      const g = str(val["gateway"]);
      if (!gateways.includes(g)) gateways.push(g);
    }
  }
  const rows = models.map((m) => {
    const values = arr(m["values"]).map(rec);
    const cells = gateways.map((g) => {
      const val = values.find((x) => str(x["gateway"]) === g);
      return val !== undefined ? html`<td>${str(val["value"])} <span class="muted">${str(val["source"])}</span></td>` : html`<td class="muted">—</td>`;
    });
    return html`<tr><td class="mono">${str(m["setting"])}</td>${cells}</tr>`;
  });
  return html`<div id="model-drift" hx-swap-oob="innerHTML"><section class="panel"><div class="panel-head"><h2>Model settings that differ</h2><span class="pill" data-tone="needs">${plural(models.length, "setting")}</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Setting</th>${gateways.map((g) => html`<th>${g}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
}

// ---- ask weave turns ----

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function chatTurn(t: Rec, now: number | undefined): SafeHtml {
  const you = html`<div class="turn you"><div class="said">${str(t["asked"])}</div></div>`;
  const answer = t["answer"];
  let body: SafeHtml | "" = "";
  if (typeof answer === "string" && answer !== "") {
    body = html`<div class="said md">${markdown(answer)}</div>`;
  } else if (t["state"] === "working") {
    const since = num(t["sinceTs"]);
    const progress = strs(t["progress"]);
    body = html`<div class="working">Working on it${since !== undefined ? html` · ${time(since, opt(now))}` : ""}${progress.length > 0 ? html`<ul>${progress.map((p) => html`<li>${p}</li>`)}</ul>` : ""}</div>`;
  } else if (t["state"] === "waiting") {
    body = html`<div class="said muted">Waiting for a worker…</div>`;
  } else if (t["state"] === "failed") {
    body = html`<div class="said muted">${"That didn't work."}</div>`;
  }
  const panels = arr(t["panels"]).map(panel);
  const taskId = str(t["taskId"]);
  const files = strs(t["files"]).map((p) =>
    taskId !== ""
      ? html`<a href="/file?path=${p}&amp;task=${taskId}" target="_blank" rel="noopener" title="${p}">${basename(p)}</a>`
      : html`<a href="/file?path=${p}" target="_blank" rel="noopener" title="${p}">${basename(p)}</a>`,
  );
  const wrote = files.length > 0 ? html`<p class="files">Wrote: ${joined(files, ", ")}</p>` : "";
  return html`${you}<div class="turn weave"><div class="who">weave</div>${body}${panels}${wrote}</div>`;
}
