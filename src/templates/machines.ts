import type { MachinesView, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { plural, time, str, num } from "../ui/format.js";
import { actionForm } from "../ui/actions.js";

/**
 * The `machines` template: the machine cards of weave's Machines page (`/machines`) as one out-of-band htmx
 * fragment, at parity with weave's machines-page.ts (docs/parity/factory-machines-team.md, ## Machines §1 and §4a).
 * The scope strip, alert and other-scope detail are the separate `fleet` template.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws.
 * Pure and synchronous; `ctx` is unused.
 */
export function machines(vm: MachinesView, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const now = num(v["now"]);
  const ms = arr(v["machines"]).map(rec);
  const quiet = ms.filter((m) => m["quiet"] === true).length;
  const newest = str(v["newestVersion"]);
  const body =
    ms.length > 0
      ? html`${ms.map((m) => machineCard(m, newest, now))}`
      : html`<p class="note">No machine has checked in yet. Start weave on one with: weave serve</p>`;

  return toHtml(
    html`<section id="view-machines" class="view machines-view" hx-get="/ui/f/machines" hx-trigger="every 10s" hx-swap="none" hx-swap-oob="true" data-nav-count="machines:${quiet}">${pageHead(ms.length, quiet)}<div id="machines">${body}</div></section>`,
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

// ---- 1. head ----

function pageHead(n: number, quiet: number): SafeHtml {
  const sentence =
    n > 0
      ? `${plural(n, "machine")}${quiet > 0 ? `, ${quiet} not heard from` : ", all connected"}.`
      : "Your machines and the agents running on them.";
  return html`<div class="page-head"><h1>Machines</h1><span class="sub" id="summary">${sentence}</span></div>`;
}

// ---- 4a. machine cards ----

const STATES = ["working", "idle", "paused", "silent"] as const;
type State = (typeof STATES)[number] | "";
const TONE: Readonly<Record<State, string>> = { working: "work", idle: "ok", paused: "needs", silent: "bad", "": "" };

function stateOf(a: Rec): State {
  return STATES.find((s) => s === a["state"]) ?? "";
}

function departedLine(a: Rec, now: number | undefined): SafeHtml {
  const version = str(a["version"]);
  return html`<div class="sub">${str(a["name"])}${version !== "" ? ` · weave ${version}` : ""} · last heard ${time(a["lastSeenTs"], opt(now))}</div>`;
}

function machineCard(m: Rec, newest: string, now: number | undefined): SafeHtml {
  const agents = arr(m["agents"]).map(rec);
  const shown = agents.filter((a) => a["departed"] !== true);
  const gone = agents.filter((a) => a["departed"] === true);
  const node = str(m["node"]);
  const heard = time(m["lastHeardTs"], opt(now));
  if (m["allDeparted"] === true) {
    return html`<div class="card"><div class="card-title">${node}</div><div class="status" data-tone="">Not heard from since ${heard} · ${plural(gone.length, "departed agent")}</div></div>`;
  }
  const quiet = m["quiet"] === true;
  const working = shown.filter((a) => stateOf(a) === "working").length;
  const status = quiet
    ? html`<div class="status" data-tone="needs">Not heard from since ${heard}</div>`
    : html`<div class="status" data-tone="ok">Connected · last heard ${heard} · ${plural(shown.length, "agent")}${working > 0 ? `, ${working} working` : ""}</div>`;
  const remedy = str(m["remedy"]);
  const why = remedy !== "" ? html`<div class="card-why">${remedy}</div>` : "";
  const more =
    gone.length > 0
      ? html`<details class="more" data-keep="${`departed:${node}`}"><summary>+${gone.length} departed</summary>${gone.map((a) => departedLine(a, now))}</details>`
      : "";
  return html`<div class="${quiet ? "card needs" : "card"}"><div class="card-title">${node}</div>${status}${why}${shown.map((a) => agentRow(a, newest, now))}${more}</div>`;
}

function agentRow(a: Rec, newest: string, now: number | undefined): SafeHtml {
  const state = stateOf(a);
  const name = str(a["name"]);
  const id = str(a["agent"]);
  const role = str(a["role"]);
  const doing = rec(a["doing"]);
  const paused = rec(a["paused"]);

  let what: SafeHtml;
  if (state === "working" && typeof a["doing"] === "object" && a["doing"] !== null) {
    what = html`Working on <a href="/task?id=${str(doing["taskId"])}">${str(doing["title"])}</a>`;
  } else if (state === "paused") {
    const reason = str(paused["reason"]);
    what = html`Paused by ${str(paused["by"])}${reason !== "" ? ` — ${reason}` : ""}`;
  } else if (state === "silent") {
    what = html`Not heard from since ${time(a["lastSeenTs"], opt(now))}`;
  } else {
    what = html`Idle`;
  }

  let button: SafeHtml | "" = "";
  if (state === "paused") {
    button = actionForm({ agent: { resume: id } }, { label: "Resume" });
  } else if (state !== "silent") {
    button = actionForm(
      { agent: { pause: id, reason: "paused from the console" } },
      {
        label: "Pause",
        tone: "quiet",
        confirm: `Pause ${name}? It finishes what it is doing now, then takes no new work until you resume it.`,
      },
    );
  }

  const backend = str(a["backend"]);
  const version = str(a["version"]);
  const sub = [backend, version !== "" ? `weave ${version}` : ""].filter((s) => s !== "").join(" · ");
  const badge = a["outdated"] === true ? html`<span class="badge" data-tone="needs">older than ${newest}</span>` : "";
  return html`<div class="row"><div class="grow"><div><span class="agent-name">${name}</span>${role !== "" ? html`<span class="muted"> · ${role}</span>` : ""}</div><div class="status" data-tone="${TONE[state]}">${what}</div><div class="sub">${sub}${badge}</div></div>${button}</div>`;
}
