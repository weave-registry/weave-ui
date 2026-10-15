/**
 * weave-ui's one `html` tagged template (ADR-0234 §4).
 *
 * Every interpolated value is escaped for the context it lands in: text, a quoted attribute value, or a URL
 * attribute (through `safeUrl`, or percent-encoded as one component after a static prefix). Sites that cannot be
 * made safe are refused with an `HtmlSiteError` when the template is built: unquoted attribute values, attribute
 * and tag names, `<script>`/`<style>` content, comments, inline handlers (`on*`, `hx-on*`), `style`, `srcdoc`, and
 * every `hx-*` attribute that is not a request URL. Static `on*`/`hx-on*`/`style` attributes are refused too, so
 * pages stay CSP-clean. There is no escape hatch: the only way to make a `SafeHtml` is this tag.
 *
 * Pure and synchronous, built-ins only: it is bundled into templates.js and run in a bare vm context.
 */

const BRAND: unique symbol = Symbol("SafeHtml");

/** Markup produced by `html`; opaque, frozen and branded so a plain string or look-alike object is never trusted. */
export type SafeHtml = { readonly [BRAND]: string };

/** Thrown when a template interpolates (or statically writes) somewhere `html` refuses. */
export class HtmlSiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HtmlSiteError";
  }
}

function makeSafe(markup: string): SafeHtml {
  return Object.freeze({ [BRAND]: markup });
}

export function isSafeHtml(x: unknown): x is SafeHtml {
  return typeof x === "object" && x !== null && typeof (x as { [BRAND]?: unknown })[BRAND] === "string";
}

export function toHtml(s: SafeHtml): string {
  if (!isSafeHtml(s)) throw new HtmlSiteError("html: toHtml expects a value built by the html tag");
  return s[BRAND];
}

// ---- escaping ----

const ESCAPE_TEST = /[&<>"']/;
const ESCAPE_ALL = /[&<>"']/g;
const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escape(s: string): string {
  return ESCAPE_TEST.test(s) ? s.replace(ESCAPE_ALL, (c) => ESCAPES[c] ?? c) : s;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function encodeComponent(s: string): string {
  return encodeURIComponent(s.replace(LONE_SURROGATE, "�"));
}

// ---- safeUrl ----

const URL_KEEP = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/;
const URL_PLAIN = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]*$/;
const HEX = /^[0-9A-Fa-f]{2}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;
const TRIM_EDGES = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const HTTP_ABSOLUTE = /^https?:\/\//i;

/**
 * A URL that is safe to put in an href/src/action: a same-origin path (`/x`, `?x`, `#x`) or an absolute
 * `http(s)://` URL, percent-encoded; anything else becomes "#".
 */
export function safeUrl(u: string): string {
  const t = String(u).replace(TRIM_EDGES, "");
  if (t === "" || CONTROL.test(t)) return "#";
  const c0 = t[0];
  const c1 = t[1];
  const sameOrigin = (c0 === "/" && c1 !== "/" && c1 !== "\\") || c0 === "?" || c0 === "#";
  if (!sameOrigin && !HTTP_ABSOLUTE.test(t)) return "#";
  if (URL_PLAIN.test(t) && t.indexOf("%") < 0) return t;
  const src = t.replace(LONE_SURROGATE, "�");
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (ch === "%") {
      out += HEX.test(src.slice(i + 1, i + 3)) ? "%" : "%25";
    } else if (URL_KEEP.test(ch)) {
      out += ch;
    } else {
      const code = src.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < src.length) {
        out += encodeURIComponent(ch + src[i + 1]);
        i++;
      } else {
        out += encodeURIComponent(ch);
      }
    }
  }
  return out;
}

// ---- template analysis ----

/** Interpolation contexts. */
const TEXT = 0;
const ATTR = 1;
const URL_WHOLE = 2;
const HX_URL_WHOLE = 3;
const URL_PART = 4;
type Ctx = typeof TEXT | typeof ATTR | typeof URL_WHOLE | typeof HX_URL_WHOLE | typeof URL_PART;

/** Scanner states. */
const S_TEXT = 0;
const S_TAG_OPEN = 1;
const S_TAG_NAME = 2;
const S_END_TAG = 3;
const S_BEFORE_ATTR = 4;
const S_ATTR_NAME = 5;
const S_AFTER_ATTR_NAME = 6;
const S_BEFORE_VALUE = 7;
const S_VALUE_QUOTED = 8;
const S_VALUE_UNQUOTED = 9;
const S_RAW = 10;
const S_RCDATA = 11;
const S_COMMENT = 12;
const S_BOGUS = 13;

const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "cite"]);
const HX_URL_ATTRS = new Set(["hx-get", "hx-post", "hx-put", "hx-patch", "hx-delete"]);
const RAW_TAGS = new Set(["script", "style"]);
const RCDATA_TAGS = new Set(["textarea", "title"]);
const HANDLER = "inline handler on* / hx-on* attribute";

function isSpace(c: string): boolean {
  return c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
}

function isHandlerName(name: string): boolean {
  return name.startsWith("on") || name.startsWith("hx-on") || name.startsWith("data-hx-on");
}

function refuse(reason: string): never {
  throw new HtmlSiteError(`html: refused interpolation site: ${reason}`);
}

function checkStaticAttr(name: string): void {
  if (isHandlerName(name)) refuse(`${HANDLER} (${name})`);
  if (name === "style") refuse("style attribute");
}

function attrContext(name: string, prefixed: boolean): Ctx {
  if (isHandlerName(name)) refuse(`${HANDLER} (${name})`);
  if (name === "style") refuse("style attribute");
  if (name === "srcdoc") refuse("srcdoc attribute");
  const base = name.startsWith("data-hx-") ? name.slice(5) : name;
  if (HX_URL_ATTRS.has(base)) return prefixed ? URL_PART : HX_URL_WHOLE;
  if (base.startsWith("hx-")) {
    refuse(
      `${name} is not a URL attribute: hx-* values other than hx-get/hx-post/hx-put/hx-patch/hx-delete must be constants`,
    );
  }
  if (URL_ATTRS.has(name)) return prefixed ? URL_PART : URL_WHOLE;
  return ATTR;
}

/** Whether `chunk` at `i` starts the closing tag `</tag` (followed by a space, '/', '>' or the chunk's end). */
function closesAt(chunk: string, i: number, tag: string): boolean {
  if (chunk.charCodeAt(i + 1) !== 47) return false;
  if (chunk.slice(i + 2, i + 2 + tag.length).toLowerCase() !== tag) return false;
  const after = chunk[i + 2 + tag.length];
  return after === undefined || after === "/" || after === ">" || isSpace(after);
}

function analyze(strings: readonly string[]): Ctx[] {
  const ctxs: Ctx[] = [];
  let state = S_TEXT;
  let tagName = "";
  let attrName = "";
  let quote = "";
  let prefixed = false;
  let special = ""; // the raw-text / RCDATA element we are inside

  const endStartTag = (): void => {
    if (RAW_TAGS.has(tagName)) {
      special = tagName;
      state = S_RAW;
    } else if (RCDATA_TAGS.has(tagName)) {
      special = tagName;
      state = S_RCDATA;
    } else {
      state = S_TEXT;
    }
  };
  const endAttrName = (): void => {
    attrName = attrName.toLowerCase();
    checkStaticAttr(attrName);
  };

  for (let k = 0; k < strings.length; k++) {
    const chunk = strings[k] as string;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i] as string;
      switch (state) {
        case S_TEXT:
          if (c === "<") {
            if (chunk.startsWith("!--", i + 1)) {
              // `<!-->` and `<!--->` are whole (empty) comments: the parser is back in text after them.
              if (chunk.startsWith(">", i + 4)) i += 4;
              else if (chunk.startsWith("->", i + 4)) i += 5;
              else {
                state = S_COMMENT;
                i += 3;
              }
            } else {
              state = S_TAG_OPEN;
            }
          }
          break;
        case S_TAG_OPEN:
          if (c === "/") {
            state = S_END_TAG;
          } else if (c === "!" || c === "?") {
            state = S_BOGUS;
          } else if (/[A-Za-z]/.test(c)) {
            tagName = c;
            state = S_TAG_NAME;
          } else {
            state = c === "<" ? S_TAG_OPEN : S_TEXT;
          }
          break;
        case S_TAG_NAME:
          if (isSpace(c) || c === "/") {
            tagName = tagName.toLowerCase();
            state = S_BEFORE_ATTR;
          } else if (c === ">") {
            tagName = tagName.toLowerCase();
            endStartTag();
          } else {
            tagName += c;
          }
          break;
        case S_END_TAG:
        case S_BOGUS:
          if (c === ">") state = S_TEXT;
          break;
        case S_BEFORE_ATTR:
          if (c === ">") endStartTag();
          else if (!isSpace(c) && c !== "/") {
            attrName = c;
            state = S_ATTR_NAME;
          }
          break;
        case S_ATTR_NAME:
          if (c === "=") {
            endAttrName();
            state = S_BEFORE_VALUE;
          } else if (isSpace(c)) {
            endAttrName();
            state = S_AFTER_ATTR_NAME;
          } else if (c === ">") {
            endAttrName();
            endStartTag();
          } else if (c === "/") {
            endAttrName();
            state = S_BEFORE_ATTR;
          } else {
            attrName += c;
          }
          break;
        case S_AFTER_ATTR_NAME:
          if (c === "=") state = S_BEFORE_VALUE;
          else if (c === ">") endStartTag();
          else if (c === "/") state = S_BEFORE_ATTR;
          else if (!isSpace(c)) {
            attrName = c;
            state = S_ATTR_NAME;
          }
          break;
        case S_BEFORE_VALUE:
          if (c === '"' || c === "'") {
            quote = c;
            prefixed = false;
            state = S_VALUE_QUOTED;
          } else if (c === ">") {
            endStartTag();
          } else if (!isSpace(c)) {
            state = S_VALUE_UNQUOTED;
          }
          break;
        case S_VALUE_QUOTED:
          if (c === quote) state = S_BEFORE_ATTR;
          else prefixed = true;
          break;
        case S_VALUE_UNQUOTED:
          if (isSpace(c)) state = S_BEFORE_ATTR;
          else if (c === ">") endStartTag();
          break;
        case S_RAW:
        case S_RCDATA:
          if (c === "<" && closesAt(chunk, i, special)) {
            state = S_END_TAG;
            i += 1 + special.length;
          }
          break;
        case S_COMMENT:
          if (c === "-" && chunk.startsWith("->", i + 1)) {
            state = S_TEXT;
            i += 2;
          } else if (c === "-" && chunk.startsWith("-!>", i + 1)) {
            state = S_TEXT;
            i += 3;
          }
          break;
      }
    }

    if (k === strings.length - 1) break;
    switch (state) {
      case S_TEXT:
      case S_RCDATA:
        ctxs.push(TEXT);
        break;
      case S_VALUE_QUOTED:
        ctxs.push(attrContext(attrName, prefixed));
        prefixed = true;
        break;
      case S_TAG_OPEN:
      case S_TAG_NAME:
      case S_END_TAG:
        refuse("tag name");
      case S_BEFORE_ATTR:
      case S_ATTR_NAME:
      case S_AFTER_ATTR_NAME:
        refuse("attribute name");
      case S_BEFORE_VALUE:
      case S_VALUE_UNQUOTED:
        refuse("unquoted attribute value");
      case S_RAW:
        refuse(`inside <${special}>`);
      case S_COMMENT:
      case S_BOGUS:
        refuse("inside a comment");
    }
  }
  // A fragment must close everything it opens, or its SafeHtml would change the context of what follows it.
  if (state !== S_TEXT) {
    throw new HtmlSiteError(
      `html: refused template: it ends inside ${state === S_RAW || state === S_RCDATA ? `<${special}>` : "a tag, attribute or comment"}`,
    );
  }
  return ctxs;
}

/** Analysis per call site: template literals reuse one strings object per site. A refusal is cached as its message. */
const analyses = new WeakMap<readonly string[], Ctx[] | string>();

function contextsFor(strings: readonly string[]): Ctx[] {
  const cached = analyses.get(strings);
  if (typeof cached === "string") throw new HtmlSiteError(cached);
  if (cached !== undefined) return cached;
  try {
    const ctxs = analyze(strings);
    analyses.set(strings, ctxs);
    return ctxs;
  } catch (e) {
    if (e instanceof HtmlSiteError) analyses.set(strings, e.message);
    throw e;
  }
}

// ---- values ----

function describe(v: unknown): string {
  if (v === true) return "true";
  return typeof v;
}

function renderText(v: unknown): string {
  if (typeof v === "string") return escape(v);
  if (typeof v === "number") return String(v);
  if (v === null || v === undefined || v === false) return "";
  if (isSafeHtml(v)) return v[BRAND];
  if (Array.isArray(v)) {
    let out = "";
    for (const item of v) out += renderText(item);
    return out;
  }
  throw new HtmlSiteError(`html: cannot render a value of type ${describe(v)}`);
}

/** An attribute value as one raw string; arrays join first so URL checks see the whole result. */
function attrString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v === null || v === undefined || v === false) return "";
  if (isSafeHtml(v)) throw new HtmlSiteError("html: SafeHtml cannot be interpolated into an attribute");
  if (Array.isArray(v)) {
    let out = "";
    for (const item of v) out += attrString(item);
    return out;
  }
  throw new HtmlSiteError(`html: cannot render a value of type ${describe(v)} in an attribute`);
}

function renderAttr(v: unknown, ctx: Ctx): string {
  if (v === null || v === undefined || v === false) return "";
  const s = attrString(v);

  switch (ctx) {
    case URL_WHOLE:
      return escape(safeUrl(s));
    case HX_URL_WHOLE: {
      const u = safeUrl(s);
      const c = u[0];
      return escape(c === "/" || c === "?" || c === "#" ? u : "#");
    }
    case URL_PART:
      return escape(encodeComponent(s));
    default:
      return escape(s);
  }
}

/** The tag. Escapes each value for its context; refuses sites that cannot be made safe. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  const ctxs = contextsFor(strings);
  let out = strings[0] as string;
  for (let i = 0; i < values.length; i++) {
    const ctx = ctxs[i] ?? refuse("more values than interpolation sites");
    const v = values[i];
    out += (ctx === TEXT ? renderText(v) : renderAttr(v, ctx)) + (strings[i + 1] ?? "");
  }
  return makeSafe(out);
}
