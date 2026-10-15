/**
 * A weave gateway body as an htmx form (ADR-0234 §1 'Actions'): POST /ui/a/<verb> with the inner body.
 *
 * The body travels in hidden inputs whose names carry the JSON type for app.js's weave-json encoder:
 * name = path[:type], path 'k' or 'k[a][b]', type bool | num | str[] | num[], and '@' for a whole scalar body.
 * No hx-* attribute carries data; the hx-post value is a static '/ui/a/' prefix plus a known verb.
 *
 * Pure and synchronous, built-ins only: it is bundled into templates.js and run in a bare vm context.
 */
import { html, safeUrl, type SafeHtml } from "../html.js";

/** weave's action routes (console-api.ts CONSOLE_ACTIONS). */
export const KNOWN_VERBS: readonly string[] = Object.freeze([
  "grant",
  "cancel",
  "chat",
  "budget",
  "yolo",
  "fleet",
  "agent",
  "plan",
  "role",
  "factory",
  "factoryNew",
  "factoryAdvance",
  "factoryClose",
  "factoryDecide",
  "fleetDecide",
  "rolloutDecide",
  "rolloutAbort",
  "releaseMergeDecide",
]);

export type Tone = "primary" | "danger" | "quiet";

export interface ActionFormOptions {
  readonly label: string;
  readonly tone?: Tone;
  readonly confirm?: string;
  readonly extra?: SafeHtml | readonly SafeHtml[];
  readonly buttonClass?: string;
}

const HTTP_ABSOLUTE = /^https?:\/\//i;
/** Nesting levels of a body's inner object kept; deeper values are skipped, so a hostile body cannot overflow the stack. */
const FIELD_DEPTH = 8;

function isPlainObject(x: unknown): x is Readonly<Record<string, unknown>> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function hidden(name: string, value: string): SafeHtml {
  return html`<input type="hidden" name="${name}" value="${value}">`;
}

/** The hidden inputs for one value at `path`, appended to `out`; values with no JSON type here are skipped. */
function fieldsFor(path: string, v: unknown, out: SafeHtml[], depth: number): void {
  if (typeof v === "string") {
    out.push(hidden(path, v));
  } else if (isFiniteNumber(v)) {
    out.push(hidden(`${path}:num`, String(v)));
  } else if (typeof v === "boolean") {
    out.push(hidden(`${path}:bool`, v ? "true" : "false"));
  } else if (Array.isArray(v)) {
    const items: readonly unknown[] = v;
    if (items.every((x) => typeof x === "string")) {
      for (const x of items) out.push(hidden(`${path}:str[]`, x as string));
    } else if (items.every(isFiniteNumber)) {
      for (const x of items) out.push(hidden(`${path}:num[]`, String(x)));
    }
  } else if (isPlainObject(v) && depth < FIELD_DEPTH) {
    for (const k of Object.keys(v)) fieldsFor(`${path}[${k}]`, v[k], out, depth + 1);
  }
}

function innerFields(inner: unknown): SafeHtml[] {
  const out: SafeHtml[] = [];
  if (typeof inner === "string") out.push(hidden("@", inner));
  else if (isFiniteNumber(inner)) out.push(hidden("@:num", String(inner)));
  else if (typeof inner === "boolean") out.push(hidden("@:bool", inner ? "true" : "false"));
  else if (isPlainObject(inner)) for (const k of Object.keys(inner)) fieldsFor(k, inner[k], out, 1);
  return out;
}

function buttonClassFor(o: ActionFormOptions): string {
  if (o.buttonClass !== undefined) return o.buttonClass;
  const tone = o.tone ?? "primary";
  return tone === "quiet" ? "btn" : `btn ${tone}`;
}

/** A gateway body `{ <verb>: inner }` as a form posting to /ui/a/<verb>; anything else is shown, never posted. */
export function actionForm(body: Readonly<Record<string, unknown>>, o: ActionFormOptions): SafeHtml {
  const keys = isPlainObject(body) ? Object.keys(body) : [];
  const verb = keys.length === 1 ? keys[0] : undefined;
  if (verb === undefined || !KNOWN_VERBS.includes(verb)) {
    return html`<span class="btn" aria-disabled="true" title="This action is not one this console can send.">${o.label}</span>`;
  }
  const fields = innerFields(body[verb]);
  const extra = o.extra ?? [];
  const button = html`<button class="${buttonClassFor(o)}" type="submit">${o.label}</button>`;
  return o.confirm !== undefined
    ? html`<form class="act" hx-post="/ui/a/${verb}" hx-swap="none" data-confirm="${o.confirm}">${fields}${extra}${button}</form>`
    : html`<form class="act" hx-post="/ui/a/${verb}" hx-swap="none">${fields}${extra}${button}</form>`;
}

/** A link styled as a button; an absolute http(s) URL opens in a new tab, an unsafe one becomes '#'. */
export function actionLink(href: unknown, label: string, cls = "btn"): SafeHtml {
  const url = safeUrl(typeof href === "string" ? href : "");
  return HTTP_ABSOLUTE.test(url)
    ? html`<a class="${cls}" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : html`<a class="${cls}" href="${url}">${label}</a>`;
}

function closeConfirm(inner: unknown): string {
  const issue = isPlainObject(inner) ? inner["issue"] : undefined;
  const n = isFiniteNumber(issue) ? String(issue) : typeof issue === "string" ? issue : "";
  return `Close #${n}? Its open stages are cancelled, and an issue on the forge is closed there.`;
}

function isTone(x: unknown): x is Tone {
  return x === "primary" || x === "danger" || x === "quiet";
}

/** An attention item's actions (contract AttentionAction[]): forms for bodies, links for hrefs; malformed ones skipped. */
export function attentionActions(actions: unknown): SafeHtml {
  if (!Array.isArray(actions)) return html``;
  const out: SafeHtml[] = [];
  for (const a of actions as readonly unknown[]) {
    if (!isPlainObject(a) || typeof a["label"] !== "string") continue;
    const label = a["label"];
    const tone: Tone = isTone(a["tone"]) ? a["tone"] : "primary";
    const own = typeof a["confirm"] === "string" ? a["confirm"] : undefined;
    const body = a["body"];
    if (isPlainObject(body)) {
      let confirm = own;
      if (Object.prototype.hasOwnProperty.call(body, "factoryClose")) {
        const ask = closeConfirm(body["factoryClose"]);
        confirm = confirm !== undefined ? `${confirm} ${ask}` : ask;
      }
      out.push(actionForm(body, confirm !== undefined ? { label, tone, confirm } : { label, tone }));
    } else if (typeof a["href"] === "string") {
      out.push(actionLink(a["href"], label));
    }
  }
  return html`${out}`;
}
