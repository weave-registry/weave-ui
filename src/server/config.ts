/**
 * The server's configuration (#8): where weave is, the console secret, where to listen, and which networks are trusted.
 *
 * The secret comes only from the environment (the sealed store injects it); there is deliberately no file form, so
 * this module touches no file API at all. Error messages name the offending variable or flag but never echo the secret
 * or the raw WEAVE_URL, which may embed credentials.
 */
import { parseCidr, type Cidr } from "./trust.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ServerConfig {
  readonly weaveUrl: string;
  readonly secret: string;
  readonly host: string;
  readonly port: number;
  readonly trustCidrs: readonly Cidr[];
}

const DEFAULT_PORT = 8789;
const DEFAULT_HOST = "127.0.0.1";
const TRUST_FLAG = "--trust-cidr";

/** Weave may live on another machine, so any host is fine; only the shape of the URL is checked. */
function parseWeaveUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") throw new ConfigError("WEAVE_URL is required");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("WEAVE_URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("WEAVE_URL must use http: or https:");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ConfigError("WEAVE_URL must not contain a username or password");
  }
  // Check the raw text too: a bare '?' or '#' leaves search/hash empty but is still not a base URL.
  if (url.search !== "" || raw.includes("?")) throw new ConfigError("WEAVE_URL must not have a query");
  if (url.hash !== "" || raw.includes("#")) throw new ConfigError("WEAVE_URL must not have a fragment");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  // An empty string is a mistake in the environment, not a request for the default.
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) throw new ConfigError("WEAVE_UI_PORT must be an integer from 1 to 65535");
  const port = Number(raw);
  if (port > 65535) throw new ConfigError("WEAVE_UI_PORT must be an integer from 1 to 65535");
  return port;
}

function cidrFrom(source: string, text: string): Cidr {
  try {
    return parseCidr(text);
  } catch (e) {
    throw new ConfigError(`${source}: ${(e as Error).message}`);
  }
}

/** Unknown flags stop the server: a typo in a trust rule must not silently leave a network untrusted (or trusted). */
function cidrsFromArgv(argv: readonly string[]): Cidr[] {
  const out: Cidr[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === TRUST_FLAG) {
      const value = argv[i + 1];
      if (value === undefined) throw new ConfigError(`${TRUST_FLAG} needs a value`);
      out.push(cidrFrom(TRUST_FLAG, value));
      i++;
    } else if (arg.startsWith(`${TRUST_FLAG}=`)) {
      const value = arg.slice(TRUST_FLAG.length + 1);
      if (value === "") throw new ConfigError(`${TRUST_FLAG} needs a value`);
      out.push(cidrFrom(TRUST_FLAG, value));
    } else {
      throw new ConfigError(`unknown argument ${JSON.stringify(arg)}; only ${TRUST_FLAG} is accepted`);
    }
  }
  return out;
}

function cidrsFromEnv(raw: string | undefined): Cidr[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => cidrFrom("WEAVE_UI_TRUST_CIDR", entry));
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>, argv: readonly string[] = []): ServerConfig {
  const weaveUrl = parseWeaveUrl(env["WEAVE_URL"]);
  const secret = env["WEAVE_CONSOLE_SECRET"];
  if (secret === undefined || secret.trim() === "") throw new ConfigError("WEAVE_CONSOLE_SECRET is required");
  const port = parsePort(env["WEAVE_UI_PORT"]);
  const host = env["WEAVE_UI_HOST"] ?? DEFAULT_HOST;
  const trustCidrs = [...cidrsFromEnv(env["WEAVE_UI_TRUST_CIDR"]), ...cidrsFromArgv(argv)];
  return { weaveUrl, secret, host, port, trustCidrs };
}
