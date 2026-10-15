/**
 * weave's markdown subset (dom-js.ts weave.md), rendered with the html tag from parsed text (ADR-0234 §4).
 *
 * Elements are built from text only; there is no raw HTML. Input is capped at 20 000 characters and 400 blocks.
 * Blocks: fenced code, headings (# → h3, ## → h4, ### and deeper → h5), rules, tables, blockquotes (parsed again,
 * depth-limited), flat lists and paragraphs. Inline, first match wins, nesting up to depth 3: `code`, **bold**,
 * [text](url), *em* / _em_, bare http(s) URLs. Every href goes through the html tag's URL context.
 *
 * Pure and synchronous, built-ins only: it is bundled into templates.js and run in a bare vm context.
 */
import { html, type SafeHtml } from "./html.js";

const MAX_CHARS = 20_000;
const MAX_BLOCKS = 400;
const MAX_TABLE_ROWS = 200;
const MAX_INLINE_DEPTH = 3;
const MAX_QUOTE_DEPTH = 3;

// ---- inline ----

const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\n]+)\*|_([^_\n]+)_|(https?:\/\/[^\s<>"']+)/g;
const TRAILING_PUNCT = /[.,;:!?]+$/;

function link(href: string, body: SafeHtml | string): SafeHtml {
  return html`<a href="${href}" target="_blank" rel="noopener noreferrer">${body}</a>`;
}

function inline(text: string, depth: number): SafeHtml {
  if (depth >= MAX_INLINE_DEPTH) return html`${text}`;
  const parts: (SafeHtml | string)[] = [];
  const re = new RegExp(INLINE.source, "g");
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const [, code, bold, linkText, linkUrl, em1, em2, bare] = m;
    if (code !== undefined) parts.push(html`<code>${code}</code>`);
    else if (bold !== undefined) parts.push(html`<strong>${inline(bold, depth + 1)}</strong>`);
    else if (linkText !== undefined && linkUrl !== undefined) parts.push(link(linkUrl, inline(linkText, depth + 1)));
    else if (em1 !== undefined) parts.push(html`<em>${inline(em1, depth + 1)}</em>`);
    else if (em2 !== undefined) parts.push(html`<em>${inline(em2, depth + 1)}</em>`);
    else if (bare !== undefined) {
      const trail = TRAILING_PUNCT.exec(bare)?.[0] ?? "";
      const url = bare.slice(0, bare.length - trail.length);
      if (url.length > 0) parts.push(link(url, url));
      if (trail !== "") parts.push(trail);
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  return html`${parts}`;
}

// ---- blocks ----

const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const UL_ITEM = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const CONTINUATION = /^ {2,}\S/;
const BLANK = /^\s*$/;

type Budget = { blocks: number };

function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableStart(lines: readonly string[], i: number): boolean {
  const next = lines[i + 1];
  return TABLE_ROW.test(lines[i] ?? "") && next !== undefined && TABLE_SEP.test(next);
}

function isSpecial(lines: readonly string[], i: number): boolean {
  const line = lines[i] ?? "";
  return (
    BLANK.test(line) ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    UL_ITEM.test(line) ||
    OL_ITEM.test(line) ||
    isTableStart(lines, i)
  );
}

function heading(level: number, text: string): SafeHtml {
  const body = inline(text.trim(), 0);
  if (level === 1) return html`<h3>${body}</h3>`;
  if (level === 2) return html`<h4>${body}</h4>`;
  return html`<h5>${body}</h5>`;
}

function blocks(src: string, quoteDepth: number, budget: Budget): SafeHtml {
  const lines = src.split(/\r?\n/);
  const out: SafeHtml[] = [];
  let i = 0;
  while (i < lines.length && budget.blocks < MAX_BLOCKS) {
    const line = lines[i] as string;

    if (BLANK.test(line)) {
      i++;
      continue;
    }
    budget.blocks++;

    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] as string)) body.push(lines[i++] as string);
      i++;
      out.push(html`<pre><code>${body.join("\n")}</code></pre>`);
      continue;
    }

    const h = HEADING.exec(line);
    if (h !== null) {
      out.push(heading((h[1] ?? "#").length, h[2] ?? ""));
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push(html`<hr>`);
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = cells(line).map((c) => html`<th>${inline(c, 0)}</th>`);
      i += 2;
      const rows: SafeHtml[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i] as string)) {
        if (rows.length < MAX_TABLE_ROWS) {
          rows.push(html`<tr>${cells(lines[i] as string).map((c) => html`<td>${inline(c, 0)}</td>`)}</tr>`);
        }
        i++;
      }
      out.push(
        html`<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`,
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      for (let q = QUOTE.exec(lines[i] ?? ""); q !== null && i < lines.length; q = QUOTE.exec(lines[i] ?? "")) {
        body.push(q[1] ?? "");
        i++;
      }
      const inner = quoteDepth < MAX_QUOTE_DEPTH ? blocks(body.join("\n"), quoteDepth + 1, budget) : paragraph(body);
      out.push(html`<blockquote>${inner}</blockquote>`);
      continue;
    }

    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const ordered = !UL_ITEM.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i] as string;
        const item = UL_ITEM.exec(l) ?? OL_ITEM.exec(l);
        if (item !== null) items.push((item[1] ?? "").trim());
        else if (items.length > 0 && CONTINUATION.test(l)) items[items.length - 1] += " " + l.trim();
        else break;
        i++;
      }
      const lis = items.map((t) => html`<li>${inline(t, 0)}</li>`);
      out.push(ordered ? html`<ol>${lis}</ol>` : html`<ul>${lis}</ul>`);
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length && !isSpecial(lines, i)) para.push(lines[i++] as string);
    out.push(paragraph(para));
  }
  return html`${out}`;
}

function paragraph(lines: readonly string[]): SafeHtml {
  const parts: SafeHtml[] = [];
  lines.forEach((l, k) => {
    if (k > 0) parts.push(html`<br>`);
    parts.push(inline(l.trim(), 0));
  });
  return html`<p>${parts}</p>`;
}

/** weave's markdown subset as SafeHtml; a non-string or empty input renders nothing. */
export function markdown(src: unknown): SafeHtml {
  if (typeof src !== "string" || src === "") return html``;
  return blocks(src.slice(0, MAX_CHARS), 0, { blocks: 0 });
}
