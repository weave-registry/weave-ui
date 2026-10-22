/**
 * The trusted-address rule (`--trust-cidr`, #8): parse a CIDR block and decide whether a peer address is inside one.
 *
 * Parsed by hand with BigInt rather than through `node:net` so the rule is strict and identical everywhere: only
 * dotted-quad IPv4 (four decimal octets, no shorthand like "10.1") and RFC 4291 IPv6 text. Anything looser would let
 * an odd spelling of an address slip past (or into) the trusted set.
 */

/** A parsed block; opaque to callers, who only pass it back to `isTrusted`. */
export interface Cidr {
  readonly family: 4 | 6;
  /** The block's base address, already masked to `prefix` bits. */
  readonly base: bigint;
  readonly prefix: number;
}

interface Addr {
  readonly family: 4 | 6;
  readonly value: bigint;
}

const BITS = { 4: 32, 6: 128 } as const;

/** Strict IPv4: exactly four decimal octets 0-255, no leading zeros (which some parsers read as octal). */
function parseV4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

/** IPv6 with optional '::' compression and an optional dotted IPv4 tail (e.g. "::ffff:10.1.2.3"). */
function parseV6(text: string): bigint | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (half: string | undefined): string[] | null => {
    if (half === undefined || half === "") return [];
    const groups = half.split(":");
    return groups.some((g) => g === "") ? null : groups;
  };
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (head === null || tail === null) return null;

  // An IPv4 tail fills the last two 16-bit groups, so it may only be the very last group of the address.
  const toWords = (groups: string[], v4TailAllowed: boolean): bigint[] | null => {
    const words: bigint[] = [];
    for (const [i, group] of groups.entries()) {
      if (v4TailAllowed && i === groups.length - 1 && group.includes(".")) {
        const v4 = parseV4(group);
        if (v4 === null) return null;
        words.push(v4 >> 16n, v4 & 0xffffn);
      } else if (/^[0-9a-fA-F]{1,4}$/.test(group)) {
        words.push(BigInt(`0x${group}`));
      } else {
        return null;
      }
    }
    return words;
  };

  let words: bigint[];
  if (halves.length === 2) {
    const headWords = toWords(head, false);
    const tailWords = toWords(tail, true);
    if (headWords === null || tailWords === null) return null;
    const missing = 8 - headWords.length - tailWords.length;
    // '::' must stand for at least one zero group.
    if (missing < 1) return null;
    words = [...headWords, ...new Array<bigint>(missing).fill(0n), ...tailWords];
  } else {
    const full = toWords(head, true);
    if (full === null || full.length !== 8) return null;
    words = full;
  }

  let value = 0n;
  for (const word of words) value = (value << 16n) | word;
  return value;
}

function parseAddr(text: string): Addr | null {
  if (text.includes(":")) {
    const value = parseV6(text);
    return value === null ? null : { family: 6, value };
  }
  const value = parseV4(text);
  return value === null ? null : { family: 4, value };
}

function mask(family: 4 | 6, prefix: number): bigint {
  const bits = BigInt(BITS[family]);
  const all = (1n << bits) - 1n;
  return (all >> BigInt(prefix)) ^ all;
}

/** Parse "addr/prefix" or a bare address (a host route); throws on anything malformed so a bad flag fails at start-up. */
export function parseCidr(text: string): Cidr {
  const fail = (): never => {
    throw new Error(`invalid cidr ${JSON.stringify(text)}: expected an IPv4 or IPv6 address, optionally /prefix`);
  };
  if (typeof text !== "string" || text === "" || /\s/.test(text)) return fail();
  const parts = text.split("/");
  if (parts.length > 2) return fail();
  const addr = parseAddr(parts[0] ?? "");
  if (addr === null) return fail();
  const bits = BITS[addr.family];
  let prefix: number = bits;
  if (parts.length === 2) {
    const p = parts[1] ?? "";
    if (!/^[0-9]{1,3}$/.test(p)) return fail();
    prefix = Number(p);
    if (prefix > bits) return fail();
  }
  return { family: addr.family, base: addr.value & mask(addr.family, prefix), prefix };
}

/** Whether `addr` (a socket's remote address) lies inside any of `nets`; unparseable input is never trusted. */
export function isTrusted(addr: string, nets: readonly Cidr[]): boolean {
  if (typeof addr !== "string" || nets.length === 0) return false;
  // A zone id names an interface, not part of the address; drop it so it can't make a match fail open or closed.
  const zone = addr.indexOf("%");
  const bare = zone === -1 ? addr : addr.slice(0, zone);
  let parsed = parseAddr(bare);
  if (parsed === null) return false;
  // A dual-stack socket reports IPv4 peers as ::ffff:a.b.c.d; judge them by their IPv4 address.
  if (parsed.family === 6 && parsed.value >> 32n === 0xffffn) {
    parsed = { family: 4, value: parsed.value & 0xffffffffn };
  }
  const peer = parsed;
  return nets.some(
    (net) => net.family === peer.family && (peer.value & mask(net.family, net.prefix)) === net.base,
  );
}

/** Loopback is always trusted (ADR-0220 §4): 127.0.0.0/8 and ::1; v4-mapped ::ffff:127.x is folded by `isTrusted`. */
const LOOPBACK: readonly Cidr[] = [parseCidr("127.0.0.0/8"), parseCidr("::1/128")];

/** Name suffixes reserved for private use, which no public DNS can hand to an attacker. */
const PRIVATE_SUFFIXES = [
  ".local",
  ".lan",
  ".home",
  ".home.arpa",
  ".internal",
  ".localdomain",
  ".localhost",
  ".ts.net",
] as const;

/**
 * May a request carrying this Host header ride its socket address's trust? ADR-0220 §4 (carried as weave-ui's own by
 * ADR-0245 §5): DNS rebinding lets a public page reach a loopback or LAN address under a name the attacker controls,
 * so only names a stranger cannot point here qualify — IP literals, `localhost`, single-label names, and private-use
 * suffixes. Absent or empty is never trustable.
 */
export function hostTrustable(host: string | undefined): boolean {
  if (typeof host !== "string") return false;
  let h = host.trim().toLowerCase();
  if (h === "") return false;

  if (h.startsWith("[")) {
    const m = /^\[([^\]]+)\](?::[0-9]*)?$/.exec(h);
    return m !== null && m[1] !== undefined && parseV6(m[1]) !== null;
  }

  h = h.replace(/:[0-9]*$/, "");
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h === "" || h.includes(":")) return false;

  if (parseV4(h) !== null) return true;
  if (h === "localhost") return true;
  if (/^[a-z0-9_-]+$/.test(h)) return true;
  return PRIVATE_SUFFIXES.some((suffix) => h.endsWith(suffix) && h.length > suffix.length);
}

/**
 * ADR-0220 §5 (ADR-0245 §5): a request another site initiated must not ride address trust. Absent (older browsers,
 * non-browser clients), `same-origin` and `none` (typed URL, bookmark) pass; `same-site` and `cross-site` do not.
 */
export function fetchSiteTrustable(v: string | undefined): boolean {
  return v === undefined || v === "same-origin" || v === "none";
}

/**
 * Is this request admitted without a session? ADR-0245 §5, applying ADR-0220 §4/§5: the SOCKET address must be
 * loopback or inside one of `cidrs`, the Host must be `hostTrustable`, and Sec-Fetch-Site must be
 * `fetchSiteTrustable`. An absent or unparseable address is never trusted, and no forwarding header (X-Forwarded-For
 * and the like) is ever consulted — the caller passes only the socket's own address.
 */
export function requestTrusted(
  r: {
    readonly remoteAddress?: string | undefined;
    readonly host?: string | undefined;
    readonly secFetchSite?: string | undefined;
  },
  cidrs: readonly Cidr[],
): boolean {
  const addr = r.remoteAddress;
  if (typeof addr !== "string" || addr === "") return false;
  if (!isTrusted(addr, LOOPBACK) && !isTrusted(addr, cidrs)) return false;
  return hostTrustable(r.host) && fetchSiteTrustable(r.secFetchSite);
}
