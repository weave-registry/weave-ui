/**
 * The formatting the weave console pages used (dom-js.ts money/plural/ago/dur/when), as pure functions.
 *
 * Pure and synchronous, built-ins only: it is bundled into templates.js and run in a bare vm context.
 * Dates are rendered in UTC with a fixed English month table so the output is the same in any zone of the daemon;
 * app.js re-renders each <time> in the browser's own zone.
 */
import { html, type SafeHtml } from "../html.js";

/** A string, or '' — for templates reading untrusted JSON. */
export function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/** A finite number, or undefined — for templates reading untrusted JSON. */
export function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

/** Dollars to two places; '<$0.01' for a sliver; '$0.00' for anything that is not a finite number. */
export function money(n: unknown): string {
  const v = num(n);
  if (v === undefined) return "$0.00";
  if (v > 0 && v < 0.01) return "<$0.01";
  return "$" + v.toFixed(2);
}

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? one + "s")}`;
}

/** A length of time in weave's buckets: seconds under 90 s, minutes under 90 m, hours under 36 h, then days. */
export function dur(ms: number): string {
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEK_MS = 7 * 86_400_000;

function shortDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

/** How long ago `ts` was, as seen at `now`: 'just now', 'in 2m', '2m ago', or a UTC short date past a week. */
export function ago(ts: number, now: number): string {
  const diff = now - ts;
  if (Math.abs(diff) < 10_000) return "just now";
  if (diff < 0) return "in " + dur(-diff);
  if (diff < WEEK_MS) return dur(diff) + " ago";
  return shortDate(ts);
}

export type TimeFmt = "ago" | "until" | "local" | "time" | "dur";

/** A <time> app.js re-renders in the browser's zone; '' for a missing or non-finite ts. */
export function time(ts: unknown, opts: { now?: number; fmt?: TimeFmt; to?: number } = {}): SafeHtml {
  const t = num(ts);
  if (t === undefined) return html``;
  const date = new Date(t);
  if (!Number.isFinite(date.getTime())) return html``;
  const iso = date.toISOString();
  const fmt = opts.fmt ?? "ago";
  const now = num(opts.now);
  const to = num(opts.to);
  let fallback = iso;
  if (fmt === "dur") {
    const end = to ?? now;
    if (end !== undefined) fallback = dur(Math.abs(end - t));
  } else if (now !== undefined) {
    fallback = ago(t, now);
  }
  if (to !== undefined) {
    return html`<time datetime="${iso}" data-ts="${t}" data-fmt="${fmt}" data-to="${to}">${fallback}</time>`;
  }
  return html`<time datetime="${iso}" data-ts="${t}" data-fmt="${fmt}">${fallback}</time>`;
}

/** The factory's stages: display name and what the stage does. */
const STAGES: Readonly<Record<string, { name: string; verb: string }>> = {
  triage: { name: "Triage", verb: "decide what the issue needs first" },
  intent: { name: "Intent", verb: "write down what was asked" },
  design: { name: "Design", verb: "record the design decision" },
  plan: { name: "Plan", verb: "write the plan and the test that proves it" },
  build: { name: "Build", verb: "make the change" },
  verify: { name: "Verify", verb: "prove the change works" },
  ship: { name: "Ship", verb: "push the branch and open the pull request" },
  review: { name: "Review", verb: "review the pull request" },
  close: { name: "Close", verb: "learn from the result and file follow-ups" },
  merge: { name: "Merge", verb: "merge the pull request" },
};

function stage(s: string): { name: string; verb: string } | undefined {
  return Object.prototype.hasOwnProperty.call(STAGES, s) ? STAGES[s] : undefined;
}

export function stageName(s: string): string {
  return stage(s)?.name ?? s;
}

export function stageVerb(s: string): string {
  return stage(s)?.verb ?? "run";
}

const TOOLS: Readonly<Record<string, string>> = {
  bash: "wants to run a command",
  write_file: "wants to write a file",
  edit_file: "wants to edit a file",
  git: "wants to run git",
  propose: "wants to open a pull request",
  verify: "wants to run the tests",
};

/** What an agent asking for `tool` wants to do, in words. */
export function toolPhrase(tool: unknown): string {
  if (typeof tool !== "string" || tool === "") return "wants to use a tool";
  if (Object.prototype.hasOwnProperty.call(TOOLS, tool)) return TOOLS[tool] ?? "wants to use a tool";
  if (tool.startsWith("hexa_")) return `wants to use hexa (${tool.slice(5)}) — this spends Claude credits`;
  return `wants to use ${tool}`;
}
