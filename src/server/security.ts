/**
 * The browser-side protections (#8) that moved from weave to weave-ui: the CSP with its sibling headers, and CSRF.
 *
 * CSRF is layered: a state-changing request must not come from another site (Sec-Fetch-Site, Origin) and must carry a
 * token bound to its session (an HMAC of the session id), so a forged form or cross-origin fetch fails either way.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Request headers as node delivers them: lowercase names, possibly absent. */
export type Headers = Record<string, string | undefined>;

export type CsrfResult = { ok: true } | { ok: false; reason: string };

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

/** The headers every response carries; a fresh object each call so a caller may add to it. */
export function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "cache-control": "no-store",
  };
}

/** The session's CSRF token: HMAC-SHA256 of the session id under `key`, base64url (safe in a header or URL). */
export function csrfToken(key: string, sessionId: string): string {
  return createHmac("sha256", key).update(sessionId).digest("base64url");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAME_SITE_FETCH = new Set(["same-origin", "none"]);

/** Decide whether a request may proceed; refusal reasons name the failed check but never echo the token. */
export function checkCsrf(req: {
  method: string;
  headers: Headers;
  key: string;
  sessionId: string;
}): CsrfResult {
  const method = req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return { ok: true };

  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite !== undefined && !SAME_SITE_FETCH.has(fetchSite)) {
    return { ok: false, reason: "csrf: cross-site request refused (sec-fetch-site)" };
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost: string | null = null;
    if (origin !== "null") {
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
    }
    if (originHost === null || originHost === "" || originHost !== req.headers.host) {
      return { ok: false, reason: "csrf: origin does not match this host" };
    }
  }

  const given = req.headers["x-csrf-token"];
  if (given === undefined || given === "") {
    return { ok: false, reason: "csrf: missing x-csrf-token" };
  }
  const expected = Buffer.from(csrfToken(req.key, req.sessionId));
  const actual = Buffer.from(given);
  // timingSafeEqual throws on unequal lengths; a length mismatch is simply a wrong token.
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "csrf: invalid x-csrf-token" };
  }
  return { ok: true };
}
