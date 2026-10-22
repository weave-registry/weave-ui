/**
 * weave-ui's server process entry (weave ADR-0245 §2): starts the server from the environment and exits cleanly on
 * SIGTERM/SIGINT. The systemd unit runs it under `weave secret exec WEAVE_CONSOLE_SECRET -- ...`, so the secret arrives
 * in the environment and never on a command line. A bad configuration exits 1 with the problem, never the secret.
 */
import { startServer } from "./main.js";

try {
  const server = await startServer({ env: process.env, argv: process.argv.slice(2) });
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      server.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
} catch (e) {
  process.stderr.write("weave-ui: " + (e instanceof Error ? e.message : String(e)) + "\n");
  process.exit(1);
}
