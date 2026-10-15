/**
 * ADR-0234 §4: the hx-on / inline-handler lint — a build step and a test, not a new tool. weave-ui's output must carry
 * no inline on* handler, no hx-on* or hx-vars attribute, no inline <script> or <style>, no style= attribute, no framing
 * or plugin element, no <base>, and no javascript: (or vbscript:/data:) URL. Markup is tokenised with weave's
 * byte-identical `htmlShape`; only script content and URL values, which the shape drops, are read from the raw html.
 *
 * As a CLI: `tsx scripts/lint.ts <dir>` lints every .html file under <dir> and exits 1 if any problem is found.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { htmlShape } from "../vendor/weave/html-shape.js";

/** Elements refused outright: they frame, embed or re-base content. */
const REFUSED_ELEMENTS = new Set(["iframe", "frame", "object", "embed", "base"]);

/** A script element in the raw html: its attributes and its content (to its closing tag or end of input). */
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)(?:<\/script\b[^>]*>|$)/gi;

/** A URL attribute whose value, quoted or not and after leading whitespace, starts with a script-capable scheme. */
const URL_RE = /(?<![\w-])(href|src|action|formaction|poster)\s*=\s*["']?\s*(javascript|vbscript|data):/gi;

/** Splits a shape token `<name attr1 attr2=… …>` into its element name and attribute names. */
function parseToken(token: string): { name: string; attrs: string[] } | null {
  if (!token.startsWith("<") || token.startsWith("</") || token.startsWith("<!")) return null;
  const parts = token.slice(1, -1).split(" ");
  const name = parts[0] ?? "";
  const attrs = parts.slice(1).map((a) => {
    const eq = a.indexOf("=");
    return eq === -1 ? a : a.slice(0, eq);
  });
  return { name, attrs };
}

/** Lints one HTML document or fragment: one human-readable problem per finding, empty when clean. */
export function lintHtml(html: string): string[] {
  const problems: string[] = [];
  for (const token of htmlShape(html)) {
    const tag = parseToken(token);
    if (tag === null) continue;
    const { name, attrs } = tag;
    if (name === "style") problems.push("style element");
    if (name === "script" && !attrs.includes("src")) problems.push("inline script (<script> without src)");
    if (REFUSED_ELEMENTS.has(name)) problems.push(`<${name}> element`);
    for (const a of attrs) {
      if (a.startsWith("hx-on") || a.startsWith("data-hx-on")) problems.push(`hx-on attribute <${name} ${a}>`);
      else if (a.startsWith("on")) problems.push(`inline handler <${name} ${a}>`);
      else if (a === "hx-vars" || a === "data-hx-vars") problems.push(`${a} attribute (evaluates script) on <${name}>`);
      else if (a === "style") problems.push(`style attribute (CSP style-src self) on <${name}>`);
    }
  }
  for (const m of html.matchAll(SCRIPT_RE)) {
    const attrs = m[1] ?? "";
    const content = m[2] ?? "";
    if (/(?<![\w-])src\s*=/i.test(attrs) && /\S/.test(content)) problems.push("inline script (content inside <script src>)");
  }
  for (const m of html.matchAll(URL_RE)) {
    const attr = (m[1] ?? "").toLowerCase();
    const scheme = (m[2] ?? "").toLowerCase();
    problems.push(`javascript: URL (${scheme}:) in ${attr}`);
  }
  return problems;
}

/** Every .html file under `dir`, recursively, as full paths. */
function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.isFile() && e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

const argv1 = process.argv[1];
if (argv1 !== undefined && import.meta.url === pathToFileURL(argv1).href) {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("usage: lint.ts <dir>");
    process.exit(2);
  }
  let failed = false;
  for (const file of htmlFiles(dir)) {
    for (const problem of lintHtml(readFileSync(file, "utf8"))) {
      console.error(`${file}: ${problem}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}
