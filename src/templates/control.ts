import type { ControlView, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { money, plural, time, str, num } from "../ui/format.js";
import { actionForm } from "../ui/actions.js";

/**
 * The `control` template: weave's Control page (`/control`) as one out-of-band htmx fragment, at parity with weave's
 * control-page.ts (docs/parity/home-work-control.md, ## Control): what the control plane is and whether every peer
 * applies it, each Raft voter's state, which models tasks ran on, and what it costs against the budget.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws.
 * Pure and synchronous; `ctx` is unused.
 */
export function control(vm: ControlView, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const now = num(v["now"]);
  const c = rec(v["control"]);
  const m = rec(v["models"]);
  const k = rec(v["costs"]);
  const raft = v["raft"];

  return toHtml(
    html`<section id="view-control" class="view control" hx-get="/ui/f/control" hx-trigger="every 15s" hx-swap="none" hx-swap-oob="true">${pageHead(c, m, k)}<h2 class="section">Control plane</h2><div id="sec-control">${controlSection(c, now)}</div><div id="sec-peers">${peersSection(c)}</div><h3 class="small">Raft control plane</h3><div id="sec-raft">${typeof raft === "object" && raft !== null ? raftSection(rec(raft), now) : ""}</div><h2 class="section">Models</h2><div id="sec-models">${modelsSection(m, now)}</div><div id="sec-hosts">${hostsSection(m)}</div><h2 class="section">Costs</h2><div id="sec-costs">${costsSection(k)}</div></section>`,
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

/** A list's rows (RowList.results), each guarded. */
function rows(list: unknown): Rec[] {
  return arr(rec(list)["results"]).map(rec);
}

/** A number or a string as text; '' otherwise. */
function txt(x: unknown): string {
  const n = num(x);
  return n !== undefined ? String(n) : str(x);
}

function strs(x: unknown): string[] {
  return arr(x).filter((s): s is string => typeof s === "string");
}

// ---- shared pieces ----

interface Col {
  readonly label: string;
  readonly num?: boolean;
  readonly get: (r: Rec) => SafeHtml | string;
}

function table(cols: readonly Col[], data: readonly Rec[]): SafeHtml {
  const head = cols.map((c) => (c.num === true ? html`<th class="num">${c.label}</th>` : html`<th>${c.label}</th>`));
  const body = data.map(
    (r) => html`<tr>${cols.map((c) => (c.num === true ? html`<td class="num">${c.get(r)}</td>` : html`<td>${c.get(r)}</td>`))}</tr>`,
  );
  return html`<div class="table-wrap"><table class="table"><tr>${head}</tr>${body}</table></div>`;
}

/** The truncation note, when a list holds fewer rows than it has. */
function note(list: unknown): SafeHtml {
  const l = rec(list);
  const count = num(l["count"]);
  const total = num(l["total"]);
  return count !== undefined && total !== undefined && count < total ? html`<p class="unavail">${str(l["note"])}</p>` : html``;
}

/** A section whose data is missing, drawn with why and the remedy. */
function unavailable(u: unknown): SafeHtml {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return html``;
  const r = rec(u);
  return html`<p class="unavail" role="status"><strong>${str(r["why"])}</strong> — ${str(r["remedy"])}</p>`;
}

function kv(pairs: readonly (readonly [string, SafeHtml | string] | undefined)[]): SafeHtml {
  return html`<dl class="kv">${pairs.map((p) => (p !== undefined ? html`<dt>${p[0]}</dt><dd>${p[1]}</dd>` : ""))}</dl>`;
}

function badge(text: string, tone: string): SafeHtml {
  return html`<span class="badge" data-tone="${tone}">${text}</span>`;
}

function basis(b: unknown): SafeHtml {
  return badge(str(b), b === "measured" ? "ok" : "needs");
}

function mono(s: string): SafeHtml {
  return html`<span class="mono">${s}</span>`;
}

function taskLink(r: Rec): SafeHtml {
  const task = str(r["task"]);
  const title = str(r["title"]);
  return html`<a href="/task?id=${encodeURIComponent(task)}">${title !== "" ? title : task}</a>`;
}

// ---- head ----

function pageHead(c: Rec, m: Rec, k: Rec): SafeHtml {
  const budget = rec(c["budget"]);
  const halted = rec(c["halt"])["halted"] === true;
  const state = halted ? html`<span><b class="bad">Halted</b></span>` : html`<span><b class="ok">Running</b></span>`;
  const spent = money(k["spentUsd"]);
  const spentB = k["over"] === true ? html`<b class="bad">${spent}</b>` : n0(k["fraction"]) >= 0.9 ? html`<b class="needs">${spent}</b>` : html`<b>${spent}</b>`;
  const total = n0(rec(m["tasks"])["total"]);
  const source = budget["source"] === "log" ? html`<b>the log</b>` : html`<b>startup</b>`;
  return html`<div class="page-head"><h1>Control</h1><div class="stats" id="summary">${state}<span>${spentB} of ${money(budget["usd"])} in ${txt(k["windowHours"])}h</span><span><b>${total}</b> ${total === 1 ? "task" : "tasks"} in ${txt(m["windowHours"])}h</span><span>budget from ${source}</span></div></div>`;
}

// ---- 1. control plane ----

function src(v: Rec, now: number | undefined): SafeHtml {
  if (v["source"] !== "log") return html`startup default (no budget.set on the log)`;
  const by = str(v["setBy"]);
  const at = num(v["setAt"]);
  return html`set on the log${by !== "" ? ` by ${by}` : ""}${at !== undefined ? html` · ${time(at, opt(now))}` : ""}`;
}

function controlSection(c: Rec, now: number | undefined): SafeHtml {
  const budget = rec(c["budget"]);
  const per = rec(c["perTaskUsd"]);
  const perUsd = n0(per["usd"]);
  const budgetCard = html`<div class="card"><div class="card-title">Budget</div>${kv([
    ["Fleet", html`${money(budget["usd"])} per ${txt(c["windowHours"])}h · ${src(budget, now)}`],
    ["Per task", html`${perUsd > 0 ? money(perUsd) : "no ceiling"} · ${src(per, now)}`],
  ])}</div>`;

  const y = rec(c["yolo"]);
  const g = rec(c["guard"]);
  const yBy = str(y["by"]);
  const yEnded = str(y["ended"]);
  const gBy = str(g["by"]);
  const gSince = num(g["since"]);
  const yolo =
    y["on"] === true
      ? html`on${num(y["until"]) !== undefined ? html` until ${time(y["until"], { fmt: "local" })}` : ""}${yBy !== "" ? ` · by ${yBy}` : ""}`
      : html`off${yEnded !== "" ? ` (${yEnded})` : ""}`;
  const yoloSwitch =
    y["on"] === true
      ? actionForm({ yolo: { off: true } }, { label: "Turn yolo off", tone: "quiet" })
      : actionForm(
          { yolo: { on: true } },
          {
            label: "Turn yolo on",
            confirm:
              "Turn yolo on? Until it ends, the factory advances and re-runs stages, small, evidenced factory pull requests merge themselves (within the cap), and fleet requests run without your Approve.",
            extra: html`<select name="for" class="yolo-pick" aria-label="For how long"><option value="1h">1 hour</option><option value="4h">4 hours</option><option value="8h" selected>8 hours</option><option value="24h">1 day</option><option value="72h">3 days</option></select>`,
          },
        );
  const autonomy = html`<div class="card"><div class="card-title">Autonomy and guard</div>${kv([
    ["Yolo", html`${yolo} ${yoloSwitch}`],
    ["Guard", html`${str(g["mode"])}${gBy !== "" ? ` · set by ${gBy}` : ""}${gSince !== undefined ? html` · ${time(gSince, opt(now))}` : ""}`],
    ["Digest", mono(str(c["digest"]))],
  ])}</div>`;

  const config = rec(c["config"]);
  const cfg = rows(config);
  const configPart =
    cfg.length > 0
      ? html`${table(
          [
            { label: "Config path", get: (r) => html`<code>${str(r["path"])}</code>` },
            { label: "Value", get: (r) => html`<code>${valueText(r["value"])}</code>` },
            { label: "Set by", get: (r) => str(r["by"]) },
            { label: "When", get: (r) => time(r["at"], opt(now)) },
          ],
          cfg,
        )}${note(config)}`
      : html`<p class="unavail">No config path is set on the log — every setting is its default (weave config schema lists them).</p>`;

  return html`<div class="grid2">${budgetCard}${haltCard(rec(c["halt"]), now)}${autonomy}</div>${configPart}`;
}

function valueText(x: unknown): string {
  if (x === null || x === undefined) return "";
  if (typeof x === "object") {
    try {
      return JSON.stringify(x) ?? "";
    } catch {
      return "";
    }
  }
  return String(x);
}

function haltCard(h: Rec, now: number | undefined): SafeHtml {
  if (h["halted"] !== true) {
    return html`<div class="card"><div class="card-title">Running</div><div class="status" data-tone="ok">Not halted — peers claim normally.</div><div class="actions">${actionForm(
      { fleet: "halt" },
      {
        label: "■ Halt",
        tone: "danger",
        confirm: "Halt the fleet? Every worker stops what it is doing and takes nothing new until you resume. Yolo mode ends.",
      },
    )}</div></div>`;
  }
  const cause = str(h["cause"]);
  const reason = str(h["reason"]);
  const by = str(h["by"]);
  const user = str(h["user"]);
  const o = rec(h["origin"]);
  const oUser = str(o["user"]);
  const oHost = str(o["host"]);
  const pid = txt(o["pid"]);
  const parent = str(o["parent"]);
  const cwd = str(o["cwd"]);
  const since = num(h["since"]);
  const who =
    oUser !== "" || oHost !== ""
      ? `${[oUser, oHost].filter((s) => s !== "").join("@")}${pid !== "" && pid !== "0" ? ` · pid ${pid}` : ""}${by !== "" ? ` · ${by}` : ""}`
      : user !== ""
        ? user
        : by !== ""
          ? by
          : "unknown";
  const confirm = `Resume the fleet? Peers start claiming and spending again${cause === "budget" ? " — and a budget halt comes back while the spend is still over." : "."}`;
  return html`<div class="card bad"><div class="card-title">Halted${h["drain"] === true ? " (drain)" : ""}</div><div class="status" data-tone="bad">${cause !== "" ? `${cause} · ` : ""}${reason !== "" ? reason : "no reason recorded"}</div>${kv([
    ["Who", who],
    since !== undefined ? ["Since", time(since, opt(now))] : undefined,
    parent !== "" ? ["From", mono(parent)] : undefined,
    cwd !== "" ? ["In", mono(cwd)] : undefined,
  ])}<div class="actions">${actionForm({ fleet: "resume" }, { label: "Resume fleet", tone: "primary", confirm })}</div></div>`;
}

const PEER_TONE: Readonly<Record<string, string>> = { "in sync": "ok", behind: "bad" };

function peersSection(c: Rec): SafeHtml {
  const peers = rec(c["peers"]);
  const p = rows(peers);
  const behind = p.filter((x) => x["state"] === "behind").length;
  const gateways = p.some((x) => x["kind"] === "gateway");
  const tone = behind > 0 ? "bad" : p.length > 0 ? "ok" : "";
  const line =
    p.length > 0
      ? `${behind > 0 ? `${behind} of ${p.length} behind the log` : `In sync on ${p.length}/${p.length}`}${gateways ? " — peers and gateways" : " peers"}`
      : "Peers: unknown";
  const tablePart =
    p.length > 0
      ? html`${table(
          [
            { label: "Peer", get: (r) => html`${str(r["agent"])}${r["kind"] === "gateway" ? html`<span class="small muted"> · gateway</span>` : ""}` },
            { label: "Host", get: (r) => str(r["node"]) },
            {
              label: "Applies",
              get: (r) => badge(str(r["state"]), typeof r["state"] === "string" && Object.prototype.hasOwnProperty.call(PEER_TONE, r["state"]) ? (PEER_TONE[r["state"]] ?? "needs") : "needs"),
            },
            { label: "Difference", get: (r) => str(r["difference"]) },
          ],
          p,
        )}${note(peers)}`
      : "";
  return html`<div class="status" data-tone="${tone}">${line}</div>${unavailable(c["unavailable"])}${tablePart}`;
}

// ---- 2. raft ----

function secs(s: number): string {
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

function raftSection(r: Rec, now: number | undefined): SafeHtml {
  const voters = rec(r["voters"]);
  const vs = rows(voters);
  const silentPresent = typeof r["silent"] === "object" && r["silent"] !== null;
  const frozenPresent = typeof r["frozen"] === "object" && r["frozen"] !== null;
  const diverging = vs.filter((v) => v["stale"] !== true && v["shadow"] === "diverges").length;
  const tone = r["mode"] === "log" ? "" : frozenPresent ? "bad" : silentPresent || diverging > 0 ? "needs" : "ok";

  const silent = rec(r["silent"]);
  const silentCard = silentPresent
    ? html`<div class="card needs"><div class="card-title">Silent: ${strs(silent["nodes"]).join(", ")}</div><div class="card-why">${str(silent["message"])} — is the voter's peer down, or back in log mode? Each row below is its last known state.</div></div>`
    : "";
  const frozen = rec(r["frozen"]);
  const fSince = num(frozen["since"]);
  const frozenCard = frozenPresent
    ? html`<div class="card bad"><div class="card-title">${str(frozen["message"])}</div><div class="card-why">A loosening (resume, raise, yolo on) is refused until a quorum returns; a tightening still applies. Not fresh: ${strs(frozen["nodes"]).join(", ")}${fSince !== undefined ? html` · since ${time(fSince, opt(now))}` : ""}</div></div>`
    : "";

  const tablePart =
    vs.length > 0
      ? html`${table(
          [
            {
              label: "Voter",
              get: (v) => {
                const stale = v["stale"] === true;
                const agent = str(v["agent"]);
                const seen = num(v["lastSeenAt"]);
                const sub =
                  stale && seen !== undefined
                    ? html`last seen ${time(seen, opt(now))} · by ${agent} · its last known state`
                    : html`reported by ${agent} · ${secs(n0(v["reportedSec"]))} ago`;
                return html`<strong>${str(v["node"])}</strong>${stale ? html` ${badge("stale", "needs")}` : ""}<div class="small muted">${sub}</div>`;
              },
            },
            {
              label: "Role",
              get: (v) => {
                const role = str(v["role"]);
                return badge(role !== "" ? role : "?", v["role"] === "leader" ? "ok" : "");
              },
            },
            { label: "Term", num: true, get: (v) => txt(v["term"]) },
            {
              label: "Leader",
              get: (v) => {
                const l = str(v["leader"]);
                return l !== "" ? l : "?";
              },
            },
            {
              label: "Commit",
              num: true,
              get: (v) => {
                const n = num(v["commit"]);
                return n !== undefined ? String(n) : "?";
              },
            },
            { label: "Applied", num: true, get: (v) => txt(v["applied"]) },
            {
              label: "Last contact",
              get: (v) =>
                html`${num(v["lastContactAt"]) !== undefined ? time(v["lastContactAt"], opt(now)) : "?"}${v["fresh"] === true ? "" : html`<div class="badge" data-tone="bad">frozen</div>`}`,
            },
            {
              label: "Shadow",
              get: (v) => {
                if (v["shadow"] === "agrees") return badge("agrees", "ok");
                const d = num(v["divergentSec"]);
                return badge(`diverges${d !== undefined ? ` for ${secs(d)}` : ""}`, "needs");
              },
            },
          ],
          vs,
        )}${note(voters)}`
      : "";

  return html`<div class="status" data-tone="${tone}">${str(r["summary"])}</div>${unavailable(r["unavailable"])}${silentCard}${frozenCard}${tablePart}`;
}

// ---- 3. models ----

function modelsSection(m: Rec, now: number | undefined): SafeHtml {
  const ulPresent = typeof m["usageLimit"] === "object" && m["usageLimit"] !== null;
  const ul = rec(m["usageLimit"]);
  const lanes = strs(ul["lanes"]);
  const until = num(ul["until"]);
  const ulCard = ulPresent
    ? html`<div class="${lanes.length > 0 ? "card needs" : "card bad"}"><div class="card-title">Claude account at its usage limit${until !== undefined ? html` until ${time(until, { fmt: "local" })}` : ""}</div><div class="card-why">${lanes.length > 0 ? `Failing over to ${lanes.join(", ")} — each re-routed task says failover:usage-limit below.` : str(ul["remedy"])}</div></div>`
    : "";

  const byModel = rows(m["byModel"]);
  const byLine =
    byModel.length > 0
      ? html`<p class="small">Last ${txt(m["windowHours"])}h by model: ${byModel.map((b, i) => html`${i > 0 ? " · " : ""}<strong>${str(b["model"])}</strong> ${plural(n0(b["tasks"]), "task")}`)}</p>`
      : "";

  const tasks = rec(m["tasks"]);
  const tr = rows(tasks);
  const tasksPart =
    tr.length > 0
      ? html`${table(
          [
            { label: "Task", get: taskLink },
            {
              label: "Named",
              get: (r) => {
                const model = str(r["model"]);
                return mono(model !== "" ? model : "peer default");
              },
            },
            {
              label: "Ran on",
              get: (r) => {
                const ran = str(r["ran"]);
                const backend = str(r["backend"]);
                const runtime = str(r["runtime"]);
                const by = str(r["by"]);
                return html`${mono(ran !== "" ? ran : "—")}${backend !== "" ? html`<div class="small muted">${backend}${runtime !== "" ? ` · ${runtime}` : ""}${by !== "" ? ` · ${by}` : ""}</div>` : ""}`;
              },
            },
            {
              label: "Why",
              get: (r) => {
                const routed = str(r["routedBy"]);
                const rerouted = str(r["rerouted"]);
                return html`${routed !== "" ? routed : str(r["reason"])}${rerouted !== "" ? html`<div class="small" data-tone="needs">${rerouted}</div>` : ""}`;
              },
            },
            { label: "When", get: (r) => time(r["ts"], opt(now)) },
          ],
          tr,
        )}${note(tasks)}`
      : "";

  return html`${ulCard}${unavailable(m["unavailable"])}${byLine}${tasksPart}`;
}

function hostsSection(m: Rec): SafeHtml {
  const dec = rows(m["declarers"]);
  const settings =
    dec.length > 0
      ? dec.map(
          (d) =>
            html`<h3 class="small">Model settings on ${str(d["gateway"])}</h3>${table(
              [
                { label: "Setting", get: (r) => mono(str(r["setting"])) },
                {
                  label: "Value",
                  get: (r) => {
                    const val = r["value"];
                    return mono(val === null || val === undefined ? "—" : txt(val));
                  },
                },
                { label: "Source", get: (r) => badge(str(r["source"]), r["source"] === "log" ? "ok" : "") },
              ],
              arr(d["settings"]).map(rec),
            )}`,
        )
      : html`<p class="unavail">No gateway reports its model settings yet — a gateway on a build older than ADR-0213 sends none; weave upgrade there.</p>`;

  const hosts = rows(m["hosts"]);
  const hostsPart =
    hosts.length > 0
      ? table(
          [
            { label: "Host", get: (r) => html`<strong>${str(r["node"])}</strong><div class="small muted">${strs(r["agents"]).join(", ")}</div>` },
            {
              label: "Default model",
              get: (r) => {
                const d = str(r["defaultModel"]);
                return mono(d !== "" ? d : "—");
              },
            },
            {
              label: "Backend",
              get: (r) => {
                const b = str(r["backend"]);
                return b !== "" ? b : "—";
              },
            },
            {
              label: "Lanes",
              get: (r) => {
                if (Array.isArray(r["lanes"])) {
                  const l = strs(r["lanes"]);
                  return l.length > 0 ? l.join(", ") : "none";
                }
                const n = str(r["note"]);
                return html`<span class="unavail">${n !== "" ? n : "unknown"}</span>`;
              },
            },
            {
              label: "Open breakers",
              get: (r) => {
                const bs = arr(r["openBreakers"]).map(rec);
                if (bs.length === 0) return "none";
                return html`${bs.map((b) => {
                  const cause = str(b["cause"]);
                  return html`<span class="badge" data-tone="bad">${str(b["key"])}${cause !== "" ? ` · ${cause}` : ""}</span>`;
                })}`;
              },
            },
          ],
          hosts,
        )
      : "";

  return html`${settings}${unavailable(m["hostsUnavailable"])}${hostsPart}`;
}

// ---- 4. costs ----

function costsSection(k: Rec): SafeHtml {
  const budget = n0(k["budgetUsd"]);
  const over = k["over"] === true;
  const pct = budget > 0 ? Math.max(0, Math.min(100, Math.round(n0(k["fraction"]) * 100))) : 0;
  const hours = txt(k["windowHours"]);
  const perTask = n0(k["perTaskUsd"]);
  const remaining = num(k["remainingUsd"]);
  const meterTone = over ? "bad" : pct >= 90 ? "needs" : "";

  const card = html`<div class="${over ? "card bad" : "card"}"><div><span class="big">${money(k["spentUsd"])}</span>${budget > 0 ? ` of ${money(budget)} in the last ${hours}h (${pct}%)` : ` metered in the last ${hours}h — no fleet budget`} ${basis(k["basis"])}</div>${budget > 0 ? html`<meter class="meter" min="0" max="100" value="${pct}" data-tone="${meterTone}" aria-label="Spend against the budget"></meter>` : ""}<div class="card-foot"><span>Per-task ceiling: ${perTask > 0 ? money(perTask) : "none"}</span>${remaining !== undefined ? html`<span>${money(remaining)} left</span>` : ""}<span>Same figures as weave spend</span></div></div>`;

  const byModel = rows(k["byModel"]);
  const byPeer = rows(k["byPeer"]);
  const byTaskList = rec(k["byTask"]);
  const byTask = rows(byTaskList);
  const none = html`<p class="unavail">none</p>`;

  const modelPart =
    byModel.length > 0
      ? table(
          [
            { label: "Model", get: (r) => mono(str(r["model"])) },
            { label: "Spend", num: true, get: (r) => money(r["usd"]) },
            { label: "Tasks", num: true, get: (r) => txt(r["tasks"]) },
            { label: "", get: (r) => basis(r["basis"]) },
          ],
          byModel,
        )
      : none;
  const peerPart =
    byPeer.length > 0
      ? table(
          [
            { label: "Peer", get: (r) => str(r["peer"]) },
            { label: "Spend", num: true, get: (r) => money(r["usd"]) },
            { label: "", get: (r) => basis(r["basis"]) },
          ],
          byPeer,
        )
      : none;
  const taskPart =
    byTask.length > 0
      ? html`${table(
          [
            { label: "Task", get: taskLink },
            { label: "Spend", num: true, get: (r) => money(r["usd"]) },
            { label: "", get: (r) => basis(r["basis"]) },
          ],
          byTask,
        )}${note(byTaskList)}`
      : none;

  return html`${card}${unavailable(k["unavailable"])}<div class="grid2"><div><h3 class="small">By model</h3>${modelPart}</div><div><h3 class="small">By peer</h3>${peerPart}</div></div><h3 class="small">Costliest tasks</h3>${taskPart}`;
}
