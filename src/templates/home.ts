import type { HomeViewModel, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { money, plural, time, stageName, stageVerb, toolPhrase, str, num } from "../ui/format.js";
import { actionForm, actionLink, attentionActions } from "../ui/actions.js";
import { markdown } from "../markdown.js";
import { panel } from "../ui/panel.js";

/**
 * The `home` template: weave's Home page (`/`) as one out-of-band htmx fragment, at parity with weave's
 * home-page.ts and harness-panel-js.ts (docs/parity/home-work-control.md, ## Home), plus the topbar's halt and
 * yolo controls (## Shared, Topbar controls), which ride in the harness panel.
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
  const work = rec(v["work"]);
  const help = n0(rec(work["summary"])["help"]);

  return toHtml(
    html`<section id="view-home" class="view home" hx-get="/ui/f/home" hx-trigger="every 10s" hx-swap="none" hx-swap-oob="true" data-needs-count="${needsCount}" data-nav-count="work:${help}"><div>${pageHead(v)}${harness(v["status"])}${needsSection(needs, needsCount, now, resumeConfirm(rec(rec(v["status"])["facts"])))}${decidedSection(v["decided"], now)}${workingSection(v["working"], v["queued"], now)}${doneSection(v["done"], now)}</div>${chatAside(v["chat"], now)}</section>`,
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

/** SafeHtml items with `sep` between them. */
function joined(items: readonly SafeHtml[], sep: string): SafeHtml {
  return html`${items.map((x, i) => (i === 0 ? x : html`${sep}${x}`))}`;
}

// ---- 1. page head ----

function pageHead(v: Rec): SafeHtml {
  const sentence = str(rec(rec(v["work"])["summary"])["sentence"]);
  const summary = sentence !== "" ? html`<p class="work-summary">${sentence} — <a href="/work">Open Work</a></p>` : "";
  return html`<div class="page-head"><h1>Home</h1><span class="sub">${str(v["brief"])}</span></div>${summary}`;
}

// ---- 2. harness panel ----

const VERDICTS = ["halted", "degraded", "working", "idle"] as const;

function harness(status: unknown): SafeHtml {
  if (typeof status !== "object" || status === null) {
    return html`<div class="harness" data-verdict="idle" role="status" aria-label="Harness status"><span class="muted">Reading the harness…</span></div>`;
  }
  const s = rec(status);
  const verdict = VERDICTS.find((x) => x === s["verdict"]) ?? "idle";
  const now = num(s["now"]);
  const reasons = arr(s["reasons"]).map(rec);
  const facts = rec(s["facts"]);
  const halted = verdict === "halted" || reasons.some((r) => r["key"] === "halt");
  const resumeAsk = resumeConfirm(facts);
  const list = reasons.length > 0 ? html`<ul class="harness-reasons">${reasons.map((r) => harnessReason(r, resumeAsk))}</ul>` : "";
  const fixes = reasons.map((r) => rec(r["fix"]));
  const reasonResume = fixes.some((f) => f["kind"] === "command" && isResume(f["body"]));
  const reasonYolo = fixes.some((f) => f["kind"] === "yolo");
  return html`<div class="harness" data-verdict="${verdict}" role="status" aria-label="Harness status"><div class="harness-head"><span class="harness-word">${str(s["word"])}</span><span class="harness-sentence">${str(s["sentence"])}</span></div>${list}<div class="harness-facts">${harnessFacts(facts, now)}</div>${fleetControls(halted, rec(facts["yolo"]), now, resumeAsk, reasonResume, reasonYolo)}</div>`;
}

const RESUME_CONFIRM = "Resume the fleet? Peers start claiming and spending again.";
const RESUME_OVER = " The fleet is over its budget; a budget halt comes back while the spend is still over.";

/** Whether a command body posts {fleet:'resume'}. */
function isResume(body: unknown): boolean {
  return rec(body)["fleet"] === "resume";
}

/** The Resume confirm; it warns when the spend is over the budget (from the harness facts). */
function resumeConfirm(facts: Rec): string {
  const spend = rec(facts["spend"]);
  return Object.keys(spend).length > 0 && n0(spend["fraction"]) >= 1 ? `${RESUME_CONFIRM}${RESUME_OVER}` : RESUME_CONFIRM;
}

function yoloPick(): SafeHtml {
  return html`<select name="for" class="yolo-pick" aria-label="For how long"><option value="1h">1 hour</option><option value="4h">4 hours</option><option value="8h" selected>8 hours</option><option value="24h">1 day</option><option value="72h">3 days</option></select>`;
}

function yoloForm(label: string, confirm?: string): SafeHtml {
  const extra = yoloPick();
  return actionForm({ yolo: { on: true } }, confirm !== undefined ? { label, confirm, extra } : { label, extra });
}

function harnessReason(r: Rec, resumeAsk: string): SafeHtml {
  const fix = rec(r["fix"]);
  const label = str(fix["label"]);
  let control: SafeHtml | "" = "";
  if (fix["kind"] === "command") {
    const body = rec(fix["body"]);
    const confirm = fix["confirm"];
    const ask = typeof confirm === "string" ? confirm : isResume(body) ? resumeAsk : undefined;
    control = actionForm(body, ask !== undefined ? { label, confirm: ask } : { label });
  } else if (fix["kind"] === "yolo") {
    const confirm = fix["confirm"];
    control = yoloForm(label, typeof confirm === "string" ? confirm : undefined);
  } else if (fix["kind"] === "link") {
    control = actionLink(fix["href"], label);
  }
  return html`<li class="harness-reason" data-key="${str(r["key"])}"><span class="grow">${str(r["text"])}</span>${control}</li>`;
}

function fact(body: SafeHtml): SafeHtml {
  return html`<span class="fact">${body}</span>`;
}

function harnessFacts(f: Rec, now: number | undefined): SafeHtml[] {
  const out: SafeHtml[] = [];
  const at = opt(now);

  // 1. hosts
  const hosts = rec(f["hosts"]);
  if (Object.keys(hosts).length > 0) {
    const versions = strs(hosts["versions"]);
    const down = strs(hosts["down"]);
    const retired = Array.isArray(hosts["retired"]) ? strs(hosts["retired"]) : undefined;
    out.push(
      fact(
        html`${n0(hosts["up"])} of ${plural(n0(hosts["total"]), "host")} up${versions.length > 0 ? ` · ${versions.join(", ")}` : ""}${down.length > 0 ? ` — not heard: ${down.join(", ")}` : ""}${retired !== undefined ? html`<span class="muted" title="${`${retired.join(", ")} — not a member, silent over a day: history`}"> · ${plural(retired.length, "retired node id")}</span>` : ""}`,
      ),
    );
  }

  // 2. machines
  for (const m of arr(f["machines"]).map(rec)) {
    const load5 = num(m["load5"]);
    const mem = num(m["memAvailablePct"]);
    const gpu = typeof m["gpu"] === "object" && m["gpu"] !== null ? rec(m["gpu"]) : undefined;
    out.push(
      fact(
        html`${str(m["node"])} · ${n0(m["cpus"])} cores · load ${n0(m["load1"])}${load5 !== undefined ? ` / ${load5}` : ""}${mem !== undefined ? ` · ${mem}% memory available` : ""}${gpu !== undefined ? ` · GPU ${n0(gpu["utilPct"])}%, memory ${n0(gpu["memUsedPct"])}%` : ""}`,
      ),
    );
  }

  // 3. agents
  const agents = rec(f["agents"]);
  if (Object.keys(agents).length > 0) {
    const live = n0(agents["live"]);
    const total = n0(agents["total"]);
    out.push(fact(html`${plural(live, "agent")} live${total > live ? ` of ${total}` : ""}`));
  }

  // 4. task counts
  out.push(fact(html`${n0(f["running"])} running · ${n0(f["queued"])} queued · ${n0(f["done24h"])} done · ${n0(f["failed24h"])} failed in 24h`));

  // 5. spend
  const spend = rec(f["spend"]);
  if (Object.keys(spend).length > 0) {
    const budget = n0(spend["budgetUsd"]);
    if (budget > 0) {
      const pct = Math.round(n0(spend["fraction"]) * 100);
      const tone = pct >= 100 ? "over" : pct >= 90 ? "hot" : "ok";
      const limit = Number.isInteger(budget) ? `$${budget}` : money(budget);
      const frees = num(spend["freesAt"]);
      out.push(
        fact(
          html`Spend ${money(spend["usd"])} of ${limit} <meter class="meter" min="0" max="100" value="${Math.min(100, Math.max(0, pct))}" data-tone="${tone}" aria-label="Spend against the budget"></meter> ${pct}%${frees !== undefined ? html` · frees up ${time(frees, at)}` : ""}`,
        ),
      );
    } else {
      out.push(fact(html`Spend ${money(spend["usd"])} · no ceiling`));
    }
  }

  // 6. yolo
  const yolo = rec(f["yolo"]);
  if (Object.keys(yolo).length > 0) {
    if (yolo["on"] === true) {
      const until = num(yolo["until"]);
      out.push(fact(html`Yolo on${until !== undefined ? html` · ends ${time(until, at)}` : ""}`));
    } else {
      const since = num(yolo["offSince"]);
      out.push(fact(html`Yolo off${since !== undefined ? html` since ${time(since, at)}` : ""}`));
    }
  }

  // 7. chief of staff
  const chief = rec(f["chief"]);
  if (Object.keys(chief).length > 0) {
    const why = str(chief["why"]);
    out.push(
      fact(
        chief["on"] === true
          ? html`Chief of staff on · ${plural(n0(chief["actsLastHour"]), "act")} in the last hour`
          : html`Chief of staff off${why !== "" ? ` (${why})` : ""}`,
      ),
    );
  }

  // 8. autonomy
  const autonomy = rec(f["autonomy"]);
  if (Object.keys(autonomy).length > 0) {
    const hrs = Math.round(n0(autonomy["windowMs"]) / 360000) / 10;
    let text = "autonomy: standard";
    if (autonomy["level"] === "full") {
      text =
        autonomy["on"] === true
          ? `autonomy: full — ${plural(n0(autonomy["merges"]), "merge")} in ${hrs}h of cap ${n0(autonomy["cap"])}`
          : "autonomy: full (off until yolo is on, guard off)";
    }
    out.push(fact(html`${text}`));
  }

  // 9. churn
  const churn = rec(f["churn"]);
  if (n0(churn["stages"]) > 0) {
    out.push(fact(html`factory: ${n0(churn["perStage"])} retries per stage (24h) · ${plural(n0(churn["diverged"]), "branch-diverged failure")}`));
  }

  // 10. control plane
  const cp = rec(f["controlPlane"]);
  const peers = n0(cp["peers"]);
  if (peers > 0) {
    const behind = arr(cp["behind"]).map(rec);
    if (behind.length > 0) {
      const who = behind.map((b) => `${str(b["agent"])} (${str(b["difference"])})`).join(", ");
      out.push(fact(html`control plane: ${behind.length} of ${plural(peers, "peer")} behind — ${who}`));
    } else {
      const gw = typeof cp["gateways"] === "object" && cp["gateways"] !== null ? rec(cp["gateways"]) : undefined;
      out.push(
        fact(
          html`control plane: in sync on ${n0(cp["inSync"])}/${peers} peers${gw !== undefined ? `, ${n0(gw["inSync"])}/${plural(n0(gw["total"]), "gateway")}` : ""}`,
        ),
      );
    }
  }

  // 11. breakers
  const breakers = rec(f["breakers"]);
  if (Object.keys(breakers).length > 0) {
    out.push(
      fact(
        html`${plural(n0(breakers["open"]), "breaker")} open${breakers["agree"] === true ? ", all peers agree" : ` — ${strs(breakers["disagree"]).join(", ")} see it differently`}`,
      ),
    );
  }

  // 12. model sources
  for (const m of arr(f["modelSources"]).map(rec)) {
    const values = arr(m["values"])
      .map(rec)
      .map((x) => `${str(x["gateway"])} ${str(x["value"])} (${str(x["source"])})`)
      .join(" · ");
    out.push(fact(html`${str(m["setting"])} differs: ${values}`));
  }

  // 13. usage limit
  const usage = rec(f["usageLimit"]);
  if (Object.keys(usage).length > 0) {
    const until = num(usage["until"]);
    const lanes = strs(usage["lanes"]);
    const remedy = str(usage["remedy"]);
    out.push(
      fact(
        html`<strong>Claude account at its usage limit</strong>${until !== undefined ? html` until ${time(until, { ...at, fmt: "local" })}` : ""}${lanes.length > 0 ? ` — failing over to ${lanes.join(", ")}` : ` — ${remedy !== "" ? remedy : "no lane to fail over to"}`}`,
      ),
    );
  }

  // 14. control page
  if (typeof f["control"] === "string") {
    out.push(fact(html`<a href="${f["control"]}">Control plane, models and costs →</a>`));
  }

  // 15. raft
  const raft = rec(f["controlRaft"]);
  if (raft["mode"] === "off") {
    out.push(
      html`<span class="fact muted" aria-disabled="true" data-fact="control-raft" title="--control-plane=shadow on a voter runs the Raft group beside the AP fold (ADR-0216)">Raft control plane: off — log mode</span>`,
    );
  } else if (raft["mode"] === "shadow") {
    const hosts = n0(raft["hosts"]);
    const agree = n0(raft["agree"]);
    const divergent = arr(raft["divergent"]).map(rec);
    const frozen = arr(raft["frozen"])
      .map(rec)
      .map((z) => html` · no quorum: control frozen on ${str(z["node"])} since ${time(z["since"], at)}`);
    const head =
      divergent.length > 0
        ? `Raft control plane (shadow): ${agree}/${plural(hosts, "host")} agree — ${divergent.map((d) => `${str(d["node"])} differs for ${n0(d["forSec"])} s`).join(", ")}`
        : `Raft control plane (shadow): in agreement on ${agree}/${plural(hosts, "host")}`;
    out.push(fact(html`${head}${frozen}`));
  }

  // 16. needs you
  out.push(fact(html`<a href="#needs-h">Needs you: ${n0(f["needsYou"])}</a>`));

  // 17. reconcile
  const rc = rec(f["reconcile"]);
  if (Object.keys(rc).length > 0) {
    const last = num(rc["lastTs"]);
    const why = str(rc["why"]);
    if (last !== undefined) {
      out.push(
        fact(
          html`Reconciled ${time(last, at)} · ${plural(n0(rc["findings"]), "drift finding")} · ${n0(rc["fixed"])} fixed · ${n0(rc["left"])} left${rc["on"] === true ? "" : ` · now off${why !== "" ? ` (${why})` : ""}`}`,
        ),
      );
    } else {
      out.push(fact(html`${rc["on"] === true ? "Reconciler on · no pass yet" : `Reconciler off${why !== "" ? ` (${why})` : ""}`}`));
    }
  }

  // 18. backlog
  const backlog = num(f["backlog"]);
  if (backlog !== undefined) out.push(fact(html`<a href="/factory">${plural(backlog, "issue")} not started on the forge</a>`));

  // 19. decisions
  const dec = rec(f["decisions"]);
  if (Object.keys(dec).length > 0) {
    out.push(
      fact(
        html`${n0(dec["open"])} open decisions (${n0(dec["proposed"])} proposed · ${n0(dec["acceptedOpen"])} accepted, not complete)`,
      ),
    );
  }

  return out;
}

const HALT_CONFIRM = "Halt the fleet? Every worker stops what it is doing and takes nothing new until you resume. Yolo mode ends.";

/** weave's topbar: Halt or Resume fleet, and the yolo switch. */
function fleetControls(
  halted: boolean,
  yolo: Rec,
  now: number | undefined,
  resumeAsk: string,
  reasonResume: boolean,
  reasonYolo: boolean,
): SafeHtml {
  const halt = halted
    ? html`<span class="fleet-halt" data-halted="true">■ Fleet halted${reasonResume ? "" : html` ${actionForm({ fleet: "resume" }, { label: "Resume fleet", confirm: resumeAsk })}`}</span>`
    : html`<span class="fleet-halt">${actionForm({ fleet: "halt" }, { label: "■ Halt", tone: "danger", confirm: HALT_CONFIRM })}</span>`;
  const until = num(yolo["until"]);
  const switcher =
    yolo["on"] === true
      ? html`<span class="yolo-badge" data-on="true">Yolo on${until !== undefined ? html` · ${time(until, { ...opt(now), fmt: "until" })}` : ""} ${actionForm({ yolo: { off: true } }, { label: "Turn off", tone: "quiet" })}</span>`
      : reasonYolo
        ? html`<span class="yolo-badge">Yolo off</span>`
        : html`<span class="yolo-badge">Yolo off ${yoloForm("Turn on")}</span>`;
  return html`<div class="fleet-controls">${halt} ${switcher}</div>`;
}

// ---- 3. needs you ----

const CLOSE_CONFIRM = (issue: string): string => `Close #${issue}? Its open stages are cancelled, and an issue on the forge is closed there.`;

function needsSection(needs: readonly Rec[], count: number, now: number | undefined, resumeAsk: string): SafeHtml {
  const head = html`<h2 class="section" id="needs-h">Needs you${count > 0 ? html`<span class="count"> (${count})</span>` : ""}</h2>`;
  if (needs.length === 0) return html`${head}<div id="needs"><p class="note">Nothing needs you right now.</p></div>`;
  return html`${head}<div id="needs">${needs.map((n) => needCard(n, now, resumeAsk))}</div>`;
}

function cardMeta(n: Rec, now: number | undefined): SafeHtml {
  const at = opt(now);
  const expires = n["kind"] === "grant" ? num(n["expiresTs"]) : undefined;
  return html`<div class="card-meta">Asked ${time(n["askedTs"], at)}${expires !== undefined ? html` · denied by silence ${time(expires, { ...at, fmt: "until" })}` : ""}</div>`;
}

function needCard(n: Rec, now: number | undefined, resumeAsk: string): SafeHtml {
  const cls = n["severity"] === "needs-you" ? "card needs" : "card";
  const kind = n["kind"];
  let body: SafeHtml;
  if (kind === "grant") body = grantCard(n, now);
  else if (kind === "stage") body = stageCard(n, now);
  else if (kind === "plan" && typeof n["plan"] === "object" && n["plan"] !== null) body = planCard(n, now);
  else if (kind === "halt") body = haltCard(n, now, resumeAsk);
  else body = attentionCard(n, now);
  return html`<div class="${cls}" data-key="${str(n["key"])}">${body}</div>`;
}

function grantCard(n: Rec, now: number | undefined): SafeHtml {
  const task = str(n["task"]);
  const id = str(n["grantId"]);
  const call = strs(n["call"]);
  return html`<div class="card-title">${task !== "" ? task : "A task"} ${toolPhrase(n["tool"])}</div>${cardMeta(n, now)}${call.length > 0 ? html`<pre>${call.join("\n")}</pre>` : ""}<div class="actions">${actionForm({ grant: { approve: id } }, { label: "Allow" })} ${actionForm({ grant: { deny: id } }, { label: "Deny", tone: "quiet" })}</div>`;
}

function stageCard(n: Rec, now: number | undefined): SafeHtml {
  const issue = num(n["issue"]) ?? 0;
  const stage = str(n["stage"]);
  const name = stageName(stage);
  const note = str(n["note"]);
  return html`<div class="card-title"><span class="ref">#${issue} ${str(n["title"])} — </span>ready for ${name}</div>${cardMeta(n, now)}<div class="card-why">${name} will ${stageVerb(stage)}.${note !== "" ? ` The last stage said: ${note}` : ""}</div><div class="actions">${actionForm({ factoryAdvance: { issue } }, { label: `Start ${name}` })} ${actionForm({ factoryClose: { issue } }, { label: "Close", tone: "quiet", confirm: CLOSE_CONFIRM(String(issue)) })} ${actionLink("/factory", "Open Factory", "btn link")}</div>`;
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

function planCard(n: Rec, now: number | undefined): SafeHtml {
  const plan = rec(n["plan"]);
  const id = str(plan["id"]);
  const task = str(n["task"]);
  const forLine = task !== "" ? html`<div class="card-why">For: <a href="/task?id=${str(plan["request"])}">${task}</a></div>` : "";
  const extra = html`<div class="plan-steps">${arr(plan["steps"]).map((s, i) => planStep(rec(s), i))}${arr(plan["roles"]).map((r) => planRole(rec(r)))}</div>`;
  return html`<div class="card-title">The chief of staff proposes: ${str(plan["summary"])}</div>${cardMeta(n, now)}${forLine}${actionForm({ plan: { accept: id } }, { label: "Start ticked", extra })}<div class="actions">${actionForm({ plan: { decline: id } }, { label: "Decline", tone: "quiet" })}</div>`;
}

function haltCard(n: Rec, now: number | undefined, resumeAsk: string): SafeHtml {
  const usd = html`<input type="number" name="usd:num" min="0" step="5" placeholder="$ per day" aria-label="New budget in dollars per day" required>`;
  return html`<div class="card-title">${str(n["title"])}</div>${cardMeta(n, now)}<div class="actions">${actionForm({ fleet: "resume" }, { label: "Resume", confirm: resumeAsk })} ${actionForm({ budget: {} }, { label: "Raise budget", tone: "quiet", extra: usd })}</div>`;
}

function attentionCard(n: Rec, now: number | undefined): SafeHtml {
  const detail = str(n["detail"]);
  const who = str(n["whoDecides"]);
  const action = str(n["action"]);
  const hasActions = arr(n["actions"]).length > 0;
  const whoLine = who !== "" ? html`<p class="card-who" data-tone="${who.startsWith("Yolo") ? "auto" : "needs"}">${who}</p>` : "";
  const fix = action !== "" ? html`<details class="fix"><summary>${hasActions ? "Details" : "How to fix"}</summary><pre>${action}</pre></details>` : "";
  const acts = hasActions ? html`<div class="actions">${attentionActions(n["actions"])}</div>` : "";
  return html`<div class="card-title">${str(n["title"])}</div>${cardMeta(n, now)}${detail !== "" ? html`<div class="card-why">${detail}</div>` : ""}${whoLine}${acts}${fix}`;
}

// ---- 4. decided for you ----

function decidedSection(decided: unknown, now: number | undefined): SafeHtml {
  const rows = arr(decided).map(rec);
  const head = html`<h2 class="section" id="decided-h">Decided for you${rows.length > 0 ? html`<span class="count"> (${rows.length})</span>` : ""}<span class="sub"> · last 24 h</span></h2>`;
  if (rows.length === 0) return html`${head}<div class="card" id="decided"><p class="note">Nothing was decided for you in the last 24 hours.</p></div>`;
  const items = rows.map((d) => {
    const why = str(d["why"]);
    return html`<div class="row"><span class="badge" data-tone="auto">${str(d["by"])}</span><div class="grow">${str(d["what"])}${why !== "" ? html`<div class="sub">${why}</div>` : ""}</div><span class="meta">${time(d["ts"], opt(now))} · <a href="${str(d["href"])}">Audit</a></span></div>`;
  });
  return html`${head}<div class="card" id="decided">${items}</div>`;
}

// ---- 5. working now ----

function workingSection(working: unknown, queued: unknown, now: number | undefined): SafeHtml {
  const rows = arr(working).map(rec);
  const q = n0(queued);
  const head = html`<h2 class="section" id="working-h">Working now</h2>`;
  const waiting = q > 0 ? html`<p class="muted small">${plural(q, "task")} waiting for a worker.</p>` : "";
  if (rows.length === 0 && q === 0) return html`${head}<div class="card" id="working"><p class="note">Nothing is running.</p></div>`;
  const items = rows.map((w) => {
    const id = str(w["taskId"]);
    const title = str(w["title"]);
    const agent = str(w["agent"]);
    const stop = actionForm(
      { cancel: id },
      { label: "Stop", buttonClass: "btn link", confirm: `Stop "${title}"? The worker aborts; what it did so far is kept.` },
    );
    return html`<div class="row"><div class="grow"><a href="/task?id=${id}">${title}</a><div class="sub">${agent !== "" ? `by ${agent}` : ""}</div></div><span class="meta">${time(w["sinceTs"], opt(now))}</span>${stop}</div>`;
  });
  return html`${head}<div class="card" id="working">${items}${waiting}</div>`;
}

// ---- 6. done recently ----

const MARKS: Readonly<Record<string, string>> = { done: "✓", failed: "✗", cancelled: "–" };

function doneSection(done: unknown, now: number | undefined): SafeHtml {
  const rows = arr(done).map(rec);
  const head = html`<h2 class="section" id="done-h">Done recently <a class="more" href="/audit?since=24h">All tasks</a></h2>`;
  if (rows.length === 0) return html`${head}<div class="card" id="done"><p class="note">Nothing has finished yet.</p></div>`;
  const items = rows.map((d) => {
    const state = d["state"] === "failed" ? "failed" : d["state"] === "cancelled" ? "cancelled" : "done";
    const summary = str(d["summary"]);
    const sub = state === "failed" ? `Failed: ${summary}` : summary;
    return html`<div class="row"><span class="mark" data-state="${state}">${MARKS[state] ?? ""}</span><div class="grow"><a href="/task?id=${str(d["taskId"])}">${str(d["title"])}</a>${summary !== "" ? html`<div class="sub">${sub}</div>` : ""}</div><span class="meta">${time(d["ts"], opt(now))}</span></div>`;
  });
  return html`${head}<div class="card" id="done">${items}</div>`;
}

// ---- 7. ask weave ----

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
  return html`<aside class="chat" id="chat-panel" aria-label="Ask weave"><div class="chat-head"><h2>Ask weave</h2> ${reset}</div><div class="chat-log" id="chat-log" data-keep-scroll>${log}</div><form class="composer" hx-post="/ui/a/chat" hx-swap="none"><textarea name="text" rows="2" placeholder="Ask a question or describe work to do" aria-label="Ask weave" data-enter-submits required></textarea><div class="actions"><span class="hint">Enter sends · Shift+Enter for a new line. Anything permanent comes to Needs you first.</span><button class="btn primary" type="submit">Send</button></div></form></aside>`;
}

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
  const files = strs(t["files"]).map(
    (p) => html`<a href="/file?path=${p}" target="_blank" rel="noopener" title="${p}">${basename(p)}</a>`,
  );
  const wrote = files.length > 0 ? html`<p class="files">Wrote: ${joined(files, ", ")}</p>` : "";
  return html`${you}<div class="turn weave"><div class="who">weave</div>${body}${panels}${wrote}</div>`;
}
