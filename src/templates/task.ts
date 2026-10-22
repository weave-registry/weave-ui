import type { TaskStory, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { money, time, dur, str, num } from "../ui/format.js";
import { actionForm } from "../ui/actions.js";
import { markdown } from "../markdown.js";

/**
 * The `task` template: weave's task story (`/task?id=`) as one out-of-band htmx fragment, at parity with weave's
 * activity-page.ts showStory (docs/parity/task-audit.md, ## Task detail). weave's 'All tasks' link went with the
 * dropped list view; a Home link stands in its place.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws.
 * Pure and synchronous; `ctx` is unused.
 */
export function task(vm: TaskStory, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const taskId = str(v["taskId"]);
  const title = str(v["title"]);
  const state = str(v["state"]);
  const [tone, sentence] = status(v, state);

  return toHtml(
    html`<section id="view-task" class="view task" hx-get="/ui/f/task?id=${taskId}" hx-trigger="every 10s" hx-swap="none" hx-swap-oob="true"><div class="page-head"><h1>${title}</h1></div><div class="status" data-tone="${tone}">${sentence}</div>${actions(taskId, title, state)}${grantsSection(v["grants"])}${resultSection(v["result"], state)}${filesSection(v["files"], taskId)}${askedSection(v["asked"])}${detailsSection(v)}</section>`,
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
  return arr(x).filter((s): s is string => typeof s === "string" && s !== "");
}

// ---- sections ----

/** weave's sentence(): the status line's tone and text by state. */
function status(v: Rec, state: string): [string, string] {
  if (state === "needs-you") return ["needs", "Waiting for your approval"];
  if (state === "working") {
    const agent = str(v["agent"]);
    return ["work", "Being worked on" + (agent ? " by " + agent : "")];
  }
  if (state === "waiting") return ["work", "Waiting for a worker to pick it up"];
  if (state === "failed") return ["bad", "Failed"];
  if (state === "cancelled") return ["", "Stopped"];
  const settled = num(v["settledTs"]);
  const declared = num(v["declaredTs"]);
  return ["ok", "Done" + (settled && declared ? " in " + dur(Math.max(0, settled - declared)) : "")];
}

function actions(taskId: string, title: string, state: string): SafeHtml {
  const running = state === "working" || state === "waiting" || state === "needs-you";
  const stop = running
    ? actionForm(
        { cancel: taskId },
        { label: "Stop", tone: "danger", confirm: `Stop "${title}"? The worker aborts; what it did so far is kept.` },
      )
    : html``;
  return html`<div class="actions">${stop}<a class="btn" href="/audit?id=${taskId}">Full record</a><a class="btn link" href="/">Home</a></div>`;
}

function grantsSection(grants: unknown): SafeHtml {
  const cards = arr(grants)
    .map(rec)
    .map((g) => {
      const tool = str(g["tool"]);
      const requestId = str(g["requestId"]);
      return html`<div class="card needs"><div class="card-title">It wants to use ${tool}</div><pre>${str(g["detail"]) || tool}</pre><div class="actions">${actionForm({ grant: { approve: requestId } }, { label: "Allow", tone: "primary" })}${actionForm({ grant: { deny: requestId } }, { label: "Deny", tone: "quiet" })}</div></div>`;
    });
  return cards.length ? html`<h2 class="section">Needs you</h2>${cards}` : html``;
}

function resultSection(result: unknown, state: string): SafeHtml {
  const r = str(result);
  if (!r) return html``;
  return html`<h2 class="section">${state === "failed" ? "Why it failed" : "Result"}</h2><div class="card md">${markdown(r)}</div>`;
}

function filesSection(files: unknown, taskId: string): SafeHtml {
  const paths = strs(files);
  if (!paths.length) return html``;
  const rows = paths.map(
    (p) =>
      taskId
        ? html`<div><a href="/file?path=${p}&amp;task=${taskId}" target="_blank" rel="noopener" title="${p}">${p.split("/").pop() ?? p}</a><span class="muted small">  ${p}</span></div>`
        : html`<div><a href="/file?path=${p}" target="_blank" rel="noopener" title="${p}">${p.split("/").pop() ?? p}</a><span class="muted small">  ${p}</span></div>`,
  );
  return html`<h2 class="section">Files it wrote</h2><div class="card">${rows}</div>`;
}

function askedSection(asked: unknown): SafeHtml {
  const text = str(asked);
  const lines = text.split("\n");
  const body =
    lines.length > 8
      ? html`<p class="text">${lines.slice(0, 8).join("\n")}</p><details><summary>Show the whole request</summary><p class="text">${lines.slice(8).join("\n")}</p></details>`
      : html`<p class="text">${text}</p>`;
  return html`<h2 class="section">What was asked</h2><div class="card">${body}</div>`;
}

function detailsSection(v: Rec): SafeHtml {
  const fact = (label: string, value: SafeHtml | string): SafeHtml => html`<dt>${label}</dt><dd>${value}</dd>`;
  const rows: SafeHtml[] = [];
  const agent = str(v["agent"]);
  if (agent) rows.push(fact("Worker", agent));
  const model = str(v["model"]);
  if (model) rows.push(fact("Model", model));
  const usd = num(v["usd"]);
  if (usd) rows.push(fact("Cost", money(usd)));
  const declared = num(v["declaredTs"]);
  if (declared) rows.push(fact("Asked", time(declared, { fmt: "local" })));
  const settled = num(v["settledTs"]);
  if (settled) rows.push(fact("Finished", time(settled, { fmt: "local" })));
  const thread = str(v["thread"]);
  if (thread) rows.push(fact("Conversation", thread));
  const parent = str(v["parent"]);
  if (parent) rows.push(fact("Started by", html`<a href="/task?id=${parent}">the task that spawned it</a>`));
  return html`<h2 class="section">Details</h2><div class="card"><dl class="facts">${rows}</dl></div>`;
}
