import type { FleetScopesView, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { dur, plural, time, str, num } from "../ui/format.js";

/**
 * The `fleet` template: the scopes strip of weave's Machines page (`/machines`) as one out-of-band htmx fragment,
 * at parity with weave's machines-page.ts (docs/parity/factory-machines-team.md, ## Machines §2, §3 and §4b).
 * The machine cards are the separate `machines` template.
 *
 * Weave selects a scope by clicking (client state, no URL). With no script here, every scope is a card, the active
 * scope's down links alert, and every other scope's read-only detail (its own down links alerting at its top) sits in a `<details data-keep>` that app.js
 * keeps open across polls.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws.
 * Pure and synchronous; `ctx` is unused.
 */
export function fleet(vm: FleetScopesView, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const now = num(v["now"]);
  const scopes = arr(v["scopes"]).map(rec);
  const body = scopes.length > 0 ? strip(scopes, rec(v["totals"]), now) : "";
  return toHtml(
    html`<section id="view-fleet" class="view fleet" hx-get="/ui/f/fleet" hx-trigger="every 15s" hx-swap="none" hx-swap-oob="true">${body}</section>`,
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

function opt(now: number | undefined): { now?: number } {
  return now !== undefined ? { now } : {};
}

/** A URL without its scheme or trailing slashes. */
function hostOf(url: unknown): string {
  return str(url).replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");
}

// ---- 2. scopes strip ----

const STATE: Readonly<Record<string, readonly [string, string]>> = {
  live: ["live", "ok"],
  attention: ["needs attention", "bad"],
  quiet: ["quiet", ""],
  dormant: ["dormant", ""],
  empty: ["empty", ""],
};

function strip(scopes: readonly Rec[], totals: Rec, now: number | undefined): SafeHtml {
  const active = scopes.find((s) => s["active"] === true);
  const activeName = active !== undefined ? str(active["scope"]) : "";
  const sum = `· ${plural(scopes.length, "scope")} · ${num(totals["liveAgents"]) ?? 0} live agents · ${num(totals["attention"]) ?? 0} needing attention`;
  const others = scopes.filter((s) => s["active"] !== true);
  return html`<div class="scopes-head"><span id="scopes-h">Scopes on this machine</span><span id="scopes-sum">${sum}</span></div><div class="scope-strip" id="scopes" role="group" aria-labelledby="scopes-h">${scopes.map(scopeCard)}</div><div class="scope-alert" id="scope-alert">${active !== undefined ? alerts(active) : ""}</div>${others.map((s) => detail(s, activeName, now))}`;
}

function counts(s: Rec): string {
  return `${num(s["liveAgents"]) ?? 0} live · ${num(s["departedAgents"]) ?? 0} departed · ${plural(num(s["silentNodes"]) ?? 0, "silent node")}`;
}

function scopeCard(s: Rec): SafeHtml {
  const state = str(s["state"]);
  const [label, tone] = Object.hasOwn(STATE, state) ? (STATE[state] ?? [state, ""]) : [state, ""];
  const isActive = s["active"] === true;
  const daemon = isActive ? html`<span class="badge" data-tone="work">this daemon</span>` : "";
  return html`<div class="scope-card" aria-current="${isActive ? "true" : "false"}" data-scope="${str(s["scope"])}" data-state="${state}"><span class="scope-name">${str(s["scope"])}</span><span class="scope-chips">${daemon}<span class="badge" data-tone="${tone}">${label}</span></span><span class="scope-counts">${counts(s)}</span><span class="card-why">${str(s["why"])}</span></div>`;
}

// ---- 3. scope alert ----

function alerts(s: Rec): SafeHtml {
  const scope = str(s["scope"]);
  return html`${arr(s["downLinks"]).map(rec).map((l) => {
    const node = str(l["node"]);
    const error = str(l["error"]);
    const down = dur(Math.max(0, (num(l["forSec"]) ?? 0) * 1000));
    return html`<div class="card bad" role="alert"><div class="card-title">${node} cannot reach ${hostOf(l["url"])}</div><div class="card-why">${error !== "" ? error : "the link is down"} · down ${down}. ${node} is live in ${scope} but its events do not reach that peer. Bring the peer back, or run weave peers leave &lt;node&gt; --scope ${scope}.</div></div>`;
  })}`;
}

// ---- 4b. another scope's read-only detail ----

function detail(s: Rec, activeName: string, now: number | undefined): SafeHtml {
  const scope = str(s["scope"]);
  const nodes = arr(s["nodes"]).map(rec);
  const error = str(s["error"]);
  const body =
    nodes.length > 0
      ? html`${nodes.map((n) => readOnlyNode(n, now))}`
      : error !== ""
        ? html`<p class="note">${"Could not read this scope's log: "}${error}</p>`
        : html`<p class="note">${"No machine has written to this scope's log."}</p>`;
  return html`<details class="card scope-detail" data-keep="scope:${scope}"><summary>${scope}</summary><div class="detail-head"><h2>${scope}</h2><span class="muted">Read-only — this console serves ${activeName !== "" ? activeName : "another scope"}.</span></div>${alerts(s)}${body}</details>`;
}

function readOnlyNode(n: Rec, now: number | undefined): SafeHtml {
  const agents = arr(n["agents"]).map(rec);
  const shown = agents.filter((a) => a["departed"] !== true);
  const gone = agents.filter((a) => a["departed"] === true);
  const silent = n["silent"] === true;
  const last = num(n["lastEventTs"]) ?? 0;
  const self = n["self"] === true ? html`<span class="ref"> · this node</span>` : "";
  const status = silent
    ? html`<div class="status" data-tone="bad">Not heard from since ${time(n["lastEventTs"], opt(now))}</div>`
    : last !== 0
      ? html`<div class="status" data-tone="ok">Last event ${time(n["lastEventTs"], opt(now))}</div>`
      : html`<div class="status" data-tone="ok">No events</div>`;
  const address = typeof n["address"] === "object" && n["address"] !== null ? rec(n["address"]) : undefined;
  const where =
    address !== undefined ? `${hostOf(address["url"])}${address["fresh"] === true ? "" : " (stale address)"}` : "No address advertised";
  const links = arr(n["links"]).map(rec);
  const linkRow = links.length > 0 ? html`<div class="links">${links.map(linkBadge)}</div>` : "";
  const more =
    gone.length > 0
      ? html`<details class="more" data-keep="departed:${str(n["node"])}"><summary>+${gone.length} departed</summary>${gone.map((a) => readOnlyAgent(a, now))}</details>`
      : "";
  const none = agents.length > 0 ? "" : html`<p class="note">No agent has heartbeated from this node.</p>`;
  return html`<div class="${silent ? "card needs" : "card"}"><div class="card-title">${str(n["node"])}${self}</div>${status}<div class="card-why">${where}</div>${linkRow}${shown.map((a) => readOnlyAgent(a, now))}${more}${none}</div>`;
}

function linkBadge(l: Rec): SafeHtml {
  const error = str(l["error"]);
  const host = hostOf(l["url"]);
  return l["up"] === true
    ? html`<span class="badge" data-tone="ok" title="${error}">↑ ${host}</span>`
    : html`<span class="badge" data-tone="bad" title="${error}">↓ ${host} · ${error !== "" ? error : "down"}</span>`;
}

function readOnlyAgent(a: Rec, now: number | undefined): SafeHtml {
  const version = str(a["version"]);
  const status =
    a["live"] === true
      ? html`<div class="status" data-tone="ok">Live</div>`
      : a["departed"] === true
        ? html`<div class="status" data-tone="">Departed · last heard ${time(a["lastSeenTs"], opt(now))}</div>`
        : html`<div class="status" data-tone="needs">Stopped · last heard ${time(a["lastSeenTs"], opt(now))}</div>`;
  const sub = version !== "" ? html`<div class="sub">weave ${version}</div>` : "";
  return html`<div class="row"><div class="grow"><div><span class="agent-name">${str(a["agent"])}</span></div>${status}${sub}</div></div>`;
}
