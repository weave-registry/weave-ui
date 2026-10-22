import type { MachinesView, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { plural, time, str, num } from "../ui/format.js";
import { actionForm } from "../ui/actions.js";

/**
 * The `machines` template: the redesigned Machines page (`/machines`) as one out-of-band htmx fragment — a head
 * (connected count, agents, versions) and one `.host-card` panel per machine with its agent rows, Pause / Resume and
 * the departed fold (docs/plans/2026-10-23-redesign-spec.md, Components and Machines). The telemetry tiles and drift
 * table come from Home's model; the scope strip, alert and other-scope detail are the separate `fleet` template.
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
  const newest = str(v["newestVersion"]);
  const body =
    ms.length > 0
      ? html`<div class="hosts" id="machines">${ms.map((m) => machineCard(m, newest, now))}</div>`
      : html`<p class="note">No machine has checked in yet. Start weave on one with: weave serve</p>`;

  return toHtml(
    html`<section id="view-machines" class="view machines-view" hx-get="/ui/f/machines" hx-trigger="every 10s" hx-swap="none" hx-swap-oob="true">${pageHead(ms)}${body}</section>`,
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

// ---- head ----

function pageHead(ms: readonly Rec[]): SafeHtml {
  if (ms.length === 0) {
    return html`<div class="page-head"><h1>Machines</h1><span class="sub">Your machines and the agents running on them.</span></div>`;
  }
  const connected = ms.filter((m) => m["quiet"] !== true).length;
  const agents = ms.flatMap((m) => arr(m["agents"]).map(rec)).filter((a) => a["departed"] !== true);
  const versions = [...new Set(agents.map((a) => str(a["version"])).filter((s) => s !== ""))];
  const vs = versions.length === 1 ? ` · all on ${versions[0]}` : versions.length > 1 ? ` · on ${versions.join(", ")}` : "";
  const tone = connected === ms.length ? "ok" : "bad";
  return html`<div class="page-head"><h1>Machines</h1><span class="sub"><b data-tone="${tone}">${connected} of ${ms.length}</b> connected · ${plural(agents.length, "agent")}${vs}</span></div>`;
}

// ---- host cards ----

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
  const quiet = m["quiet"] === true;
  const heard = time(m["lastHeardTs"], opt(now));
  if (m["allDeparted"] === true) {
    return html`<article class="panel host-card" data-quiet="${quiet ? "true" : "false"}"><div class="panel-head"><span class="dot" data-tone=""></span><h2>${node}</h2><span class="host-heard">not heard since ${heard}</span></div><p class="empty">${plural(gone.length, "departed agent")}</p></article>`;
  }
  const head = html`<div class="panel-head"><span class="dot" data-tone="${quiet ? "needs" : "ok"}"></span><h2>${node}</h2><span class="host-heard">${quiet ? "not heard since " : "heard "}${heard}</span></div>`;
  const remedy = str(m["remedy"]);
  const why = remedy !== "" ? html`<p class="host-remedy"><code>${remedy}</code></p>` : "";
  const more =
    gone.length > 0
      ? html`<details class="lrow-more" data-keep="${`departed:${node}`}"><summary>+${gone.length} departed</summary>${gone.map((a) => departedLine(a, now))}</details>`
      : "";
  return html`<article class="panel host-card" data-quiet="${quiet ? "true" : "false"}">${head}${why}<div class="lrows">${shown.map((a) => agentRow(a, newest, now))}</div>${more}</article>`;
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
  const meta = sub !== "" ? html`<span class="lrow-meta">${sub}</span>` : "";
  const badge = a["outdated"] === true ? html`<span class="badge" data-tone="needs">older than ${newest}</span>` : "";
  return html`<div class="lrow"><span class="dot" data-tone="${TONE[state]}"></span><div class="lrow-main"><div class="lrow-title">${name}${role !== "" ? html`<span class="muted"> · ${role}</span>` : ""}</div><div class="lrow-why">${what}</div></div>${meta}${badge}<div class="lrow-acts">${button}</div></div>`;
}
