import type { ErrorView, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml } from "../html.js";
import type { SafeHtml } from "../html.js";

/**
 * The `error` template: every refusal from /ui (ADR-0234 §1 "Refusals"), rendered out of band into the page's
 * error region as an alert, with its ADR-0122 resolution — the commands that fix it, and for a command that is
 * not ready, the value the caller must supply.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). It never throws on a malformed view model: any
 * field that is not a string renders as "", and a command without a string `run` is skipped.
 * Pure and synchronous; `ctx` is unused.
 */
export function error(vm: ErrorView, ctx: RenderCtx): string {
  void ctx;
  const v: unknown = vm;
  const rec = isRecord(v) ? v : {};
  const resolution = isRecord(rec["resolution"]) ? rec["resolution"] : {};
  const commands = resolution["commands"];

  const items: SafeHtml[] = [];
  if (Array.isArray(commands)) {
    for (const c of commands as unknown[]) {
      if (!isRecord(c)) continue;
      const run = c["run"];
      if (typeof run !== "string") continue;
      const why = str(c["why"]);
      items.push(
        html`<li><code>${run}</code>${why !== "" ? html`<span class="why"> — ${why}</span>` : ""}</li>`,
      );
    }
  }

  const fix = items.length > 0 ? html`<div class="fix"><p>To fix it, run:</p><ul>${items}</ul></div>` : "";

  return toHtml(
    html`<div id="weave-error" class="problem" role="alert" hx-swap-oob="true" data-code="${str(rec["code"])}"><strong>${str(rec["error"])}</strong>${fix}</div>`,
  );
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}
