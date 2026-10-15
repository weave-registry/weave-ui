/**
 * ADR-0234 §4: escaping is tested by SHAPE. A rendered fragment's structure — its tags, their attribute names in
 * order, and the path an `hx-*` attribute sends its request to — must not depend on the text the view model carries:
 * injected text may change text and quoted values, never structure. This is the pure tokenizer that reduces a fragment
 * to that shape, and the hostile corpus fed through every string leaf of a view model. Both weave's own check and
 * weave-ui's CI use this module, so it stays dependency-free: no imports, no I/O.
 */

/** Elements whose content is raw text: nothing inside them is markup until their own closing tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);
const isNameChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9-]/.test(c);
const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/**
 * Reduces an HTML fragment to its shape: one token per comment (`<!---->`), declaration (`<!doctype>`), closing tag
 * (`</name>`) and start tag (`<name attr1 attr2 …>`, with an `hx-*` attribute written `name=<path>` — its value cut at
 * the first `?` or `#`). Text is ignored, as is the content of a script, style, textarea or title element; a `<` that
 * opens no tag is text. Names are lower-cased. An unterminated tag at end of input still yields its token.
 */
export function htmlShape(html: string): string[] {
  const out: string[] = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    if (html[i] !== "<") {
      i++;
      continue;
    }
    const next = html[i + 1];
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      out.push("<!---->");
      i = end === -1 ? n : end + 3;
    } else if (next === "!") {
      const end = html.indexOf(">", i + 2);
      out.push("<!doctype>");
      i = end === -1 ? n : end + 1;
    } else if (next === "/") {
      let j = i + 2;
      while (j < n && isNameChar(html[j])) j++;
      out.push(`</${html.slice(i + 2, j).toLowerCase()}>`);
      const end = html.indexOf(">", j);
      i = end === -1 ? n : end + 1;
    } else if (isLetter(next)) {
      let j = i + 1;
      while (j < n && isNameChar(html[j])) j++;
      const name = html.slice(i + 1, j).toLowerCase();
      const attrs: string[] = [];
      while (j < n && html[j] !== ">") {
        if (isSpace(html[j]) || html[j] === "/") {
          j++;
          continue;
        }
        const start = j;
        while (j < n && !isSpace(html[j]) && html[j] !== "=" && html[j] !== ">" && html[j] !== "/") j++;
        if (j === start) {
          // A stray '=' with no name before it: step over it so the scan always advances.
          j++;
          continue;
        }
        const attr = html.slice(start, j).toLowerCase();
        let value = "";
        // HTML allows whitespace on either side of '=': `href = "x"` is one attribute with a value.
        let k = j;
        while (k < n && isSpace(html[k])) k++;
        if (html[k] === "=") {
          j = k + 1;
          while (j < n && isSpace(html[j])) j++;
          const q = html[j];
          if (q === '"' || q === "'") {
            const end = html.indexOf(q, j + 1);
            value = html.slice(j + 1, end === -1 ? n : end);
            j = end === -1 ? n : end + 1;
          } else {
            const vs = j;
            while (j < n && !isSpace(html[j]) && html[j] !== ">") j++;
            value = html.slice(vs, j);
          }
        }
        attrs.push(attr.startsWith("hx-") ? `${attr}=${value.split(/[?#]/)[0]}` : attr);
      }
      out.push(attrs.length > 0 ? `<${name} ${attrs.join(" ")}>` : `<${name}>`);
      i = j < n ? j + 1 : n;
      if (RAW_TEXT.has(name)) {
        // Searched in `html` itself, not a lower-cased copy: lower-casing can change the length ('İ' becomes two
        // code units), and an index from the copy would then point past the real closing tag. The name must end there
        // (whitespace, '/' or '>'): `</scripts>` is text inside a script, not its end.
        const closeTag = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, "gi");
        closeTag.lastIndex = i;
        const close = closeTag.exec(html);
        i = close === null ? n : close.index;
      }
    } else {
      i++;
    }
  }
  return out;
}

/** True when two fragments have the same shape, token by token — the ADR-0234 §4 escaping check. */
export function sameShape(a: string, b: string): boolean {
  const x = htmlShape(a);
  const y = htmlShape(b);
  return x.length === y.length && x.every((t, k) => t === y[k]);
}

/**
 * ADR-0234 §4's hostile corpus: a script tag, an attribute breakout, a javascript: URL, an injected hx-* request, a
 * template-expression probe, a raw-text closing-tag escape, and an over-long string.
 */
export const HOSTILE_PAYLOADS: readonly string[] = [
  "<script>alert(1)</script>",
  "\"><img src=x onerror=alert(1)>",
  "javascript:alert(1)",
  "' hx-get=\"/x\" hx-trigger=\"load\"",
  "{{constructor.constructor('alert(1)')()}}",
  "</textarea><script>alert(1)</script>",
  "A".repeat(10_000),
];

/** Counts the string leaves of a JSON-shaped value. */
function countStrings(v: unknown): number {
  if (typeof v === "string") return 1;
  if (Array.isArray(v)) return v.reduce((s: number, x: unknown) => s + countStrings(x), 0);
  if (v !== null && typeof v === "object") return Object.values(v).reduce((s: number, x: unknown) => s + countStrings(x), 0);
  return 0;
}

/** Deep-copies a JSON-shaped value, replacing its `target`-th string leaf (in order) with `payload`. */
function replaceNth(v: unknown, target: number, payload: string, counter: { n: number }): unknown {
  if (typeof v === "string") return counter.n++ === target ? payload : v;
  if (Array.isArray(v)) return v.map((x) => replaceNth(x, target, payload, counter));
  if (v !== null && typeof v === "object") {
    // fromEntries defines own properties, so a JSON `__proto__` key stays a key instead of hitting the prototype setter.
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replaceNth(x, target, payload, counter)]));
  }
  return v;
}

/**
 * Every hostile variant of a view model: for each string leaf (object properties and array items, recursively, in
 * order) and each payload in HOSTILE_PAYLOADS, one deep copy with exactly that leaf set to that payload. Non-string
 * leaves are kept; the input is never mutated.
 */
export function hostileVariants(model: unknown): unknown[] {
  const out: unknown[] = [];
  const leaves = countStrings(model);
  for (let k = 0; k < leaves; k++) {
    for (const p of HOSTILE_PAYLOADS) out.push(replaceNth(model, k, p, { n: 0 }));
  }
  return out;
}
