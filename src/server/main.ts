/**
 * weave-ui's server entry point (weave ADR-0245 §2): config from the environment, the upstream client, the changes hub
 * and the HTTP app wired together. `--insecure-upstream` is the only way to plain http on a non-loopback weave, and the
 * banner says so. The secret never reaches a log line.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createChangesHub } from "./changes.js";
import { loadConfig } from "./config.js";
import { createWeaveClient } from "./weave-client.js";

const INSECURE_FLAG = "--insecure-upstream";

export interface StartOptions {
  env: Readonly<Record<string, string | undefined>>;
  argv: readonly string[];
  listenPort?: number;
  assetsDir?: string;
  log?: (line: string) => void;
}

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const log = opts.log ?? ((line: string) => console.error(line));
  const insecureUpstream = opts.argv.includes(INSECURE_FLAG);
  const config = loadConfig(
    opts.env,
    opts.argv.filter((a) => a !== INSECURE_FLAG),
  );

  const client = createWeaveClient({ weaveUrl: config.weaveUrl, secret: config.secret, insecureUpstream });
  const hub = createChangesHub({ source: client, log });
  const app = createApp({
    client,
    hub,
    assetsDir: opts.assetsDir ?? fileURLToPath(new URL("../../dist/assets", import.meta.url)),
    trustCidrs: config.trustCidrs,
    sessionKey: randomBytes(32).toString("base64url"),
    weaveUrl: config.weaveUrl,
    insecureUpstream,
    log,
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(opts.listenPort ?? config.port, config.host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const url = `http://${host}:${port}`;
  hub.start();

  log(`weave-ui listening on ${url} — weave at ${config.weaveUrl}`);
  if (insecureUpstream) log(`weave-ui: ${INSECURE_FLAG} — the console credential crosses the network in cleartext`);
  log(`weave-ui: ${config.trustCidrs.length} trusted network(s)`);

  let closing: Promise<void> | undefined;
  return {
    url,
    close(): Promise<void> {
      closing ??= (async () => {
        await hub.stop();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      })();
      return closing;
    },
  };
}
