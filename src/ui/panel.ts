/**
 * The answer panels an agent put on the board (board_panel, ADR-0050), ported from dom-js.ts weave.panel.
 *
 * show_metrics / show_table / show_chart / show_answer, or a show_ui component tree, drawn from TEXT only and
 * bounded in size and depth. A described Button is shown as a label: its action runs through the gate from the
 * older console, not from here. Chart bars are <meter>s, never a style attribute (CSP style-src 'self').
 *
 * Pure and synchronous, built-ins only: it is bundled into templates.js and run in a bare vm context.
 */
import { html, type SafeHtml } from "../html.js";

const PANEL_NODES = 400;
const PANEL_DEPTH = 8;
const BUTTON_TITLE = "This action runs from the older console, through its approval gate.";

type Rec = Record<string, unknown>;
type Budget = { n: number };

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function rec(v: unknown): Rec {
  return typeof v === "object" && v !== null ? (v as Rec) : {};
}

/** Any value as text: objects as JSON, null/undefined as ''. */
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v) ?? "";
    } catch {
      return "";
    }
  }
  return String(v);
}

/** dom-js's `a || b`: the first truthy value. */
function or(...vs: unknown[]): unknown {
  for (const v of vs) if (v) return v;
  return vs[vs.length - 1];
}

function tone(v: unknown): string {
  const s = str(v || "").toLowerCase();
  if (/good|ok|positive|up|pass/.test(s)) return "ok";
  if (/bad|crit|error|down|negative|fail/.test(s)) return "bad";
  if (/warn|needs|pending/.test(s)) return "needs";
  return "";
}

function metricsEl(items: unknown): SafeHtml {
  const cells = list(items)
    .slice(0, 24)
    .map((x) => {
      const m = rec(x);
      const t = tone(or(m["status"], m["tone"]));
      const value = str(m["value"]);
      const label = str(or(m["label"], m["title"]));
      const inner = html`<div class="metric-value num">${value}</div><div class="metric-label">${label}</div>`;
      return t ? html`<div class="metric" data-tone="${t}">${inner}</div>` : html`<div class="metric">${inner}</div>`;
    });
  return html`<div class="metrics">${cells}</div>`;
}

function tableEl(cols: unknown, rows: unknown): SafeHtml {
  const c = list(cols);
  const head = c.length ? html`<thead><tr>${c.map((x) => html`<th>${str(x)}</th>`)}</tr></thead>` : null;
  const body = list(rows)
    .slice(0, 200)
    .map((r) => html`<tr>${list(r).map((x) => html`<td>${str(x)}</td>`)}</tr>`);
  return html`<div class="table-wrap"><table>${head}<tbody>${body}</tbody></table></div>`;
}

function chartEl(series: unknown): SafeHtml {
  const s = list(series).slice(0, 40).map(rec);
  let max = 0;
  for (const x of s) {
    const v = Number(x["value"]);
    if (Number.isFinite(v) && v > max) max = v;
  }
  const rows = s.map((x) => {
    const v = Number(x["value"]);
    const pct = max > 0 && Number.isFinite(v) ? Math.max(0, Math.round((100 * v) / max)) : 0;
    const t = tone(x["status"]);
    const meter = t
      ? html`<meter min="0" max="100" value="${pct}" data-tone="${t}"></meter>`
      : html`<meter min="0" max="100" value="${pct}"></meter>`;
    return html`<div class="bar-row"><span class="bar-label">${str(x["label"])}</span>${meter}<span class="num">${str(x["value"])}</span></div>`;
  });
  return html`<div class="bars">${rows}</div>`;
}

function uiEl(node: unknown, depth: number, budget: Budget): SafeHtml | string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node !== "object" || depth > PANEL_DEPTH || ++budget.n > PANEL_NODES) return null;
  const n = node as Rec;
  const p = rec(n["props"]);
  const kids = list(n["children"]).map((c) => uiEl(c, depth + 1, budget));
  const text = p["text"] !== null && p["text"] !== undefined ? str(p["text"]) : null;
  switch (n["component"]) {
    case "Panel":
    case "Card": {
      const title = p["title"] ? html`<div class="card-title">${str(p["title"])}</div>` : null;
      return html`<div class="card">${title}${kids}</div>`;
    }
    case "Stack":
      return html`<div class="ui-stack" data-dir="${p["direction"] === "horizontal" ? "row" : "col"}">${kids}</div>`;
    case "Grid":
      return html`<div class="ui-grid">${kids}</div>`;
    case "Divider":
      return html`<hr>`;
    case "Heading":
      return html`<h3>${kids}${text}</h3>`;
    case "Text":
      return p["mono"] ? html`<code>${kids}${text}</code>` : html`<p>${kids}${text}</p>`;
    case "Code":
      return html`<pre>${kids}${text}</pre>`;
    case "Metric":
    case "Tile":
      return metricsEl([{ label: or(p["label"], p["title"]), value: p["value"], status: or(p["status"], p["tone"]) }]);
    case "Metrics":
      return metricsEl(p["items"]);
    case "Table":
      return tableEl(p["columns"], p["rows"]);
    case "Chart":
      return chartEl(or(p["series"], p["data"]));
    case "KeyValue": {
      const pairs = list(or(p["pairs"], p["items"])).map((x) => {
        const kv = rec(x);
        return html`<dt>${str(or(kv["key"], kv["label"]))}</dt><dd>${str(kv["value"])}</dd>`;
      });
      return html`<dl class="kv">${pairs}</dl>`;
    }
    case "Pill": {
      const t = tone(or(p["tone"], p["status"]));
      const label = str(or(p["text"], p["label"]));
      return t
        ? html`<span class="badge" data-tone="${t}">${label}${kids}</span>`
        : html`<span class="badge">${label}${kids}</span>`;
    }
    case "Button":
      return html`<span class="badge" title="${BUTTON_TITLE}">${str(or(p["label"], p["text"], "Action"))}</span>`;
    case "Empty":
      return html`<p class="note">${str(or(p["text"], "Nothing to show."))}</p>`;
    default:
      return html`<div>${kids}</div>`;
  }
}

function bodyOf(p: Rec): SafeHtml | string | null {
  switch (p["type"]) {
    case "show_metrics":
      return metricsEl(p["items"]);
    case "show_table":
      return tableEl(p["columns"], p["rows"]);
    case "show_chart":
      return chartEl(p["series"]);
    case "show_answer":
      return html`<p class="panel-text">${str(p["text"])}</p>`;
    case "show_ui":
      return uiEl(p["ui"], 0, { n: 0 });
    default:
      return null;
  }
}

/** One answer panel: always a `card panel`, never throws — anything malformed draws an empty card. */
export function panel(x: unknown): SafeHtml {
  let title: SafeHtml | null = null;
  let body: SafeHtml | string | null = null;
  try {
    const p = rec(x);
    title = p["title"] ? html`<div class="card-title">${str(p["title"])}</div>` : null;
    body = bodyOf(p);
  } catch {
    title = null;
    body = null;
  }
  return html`<div class="card panel">${title}${body}</div>`;
}
