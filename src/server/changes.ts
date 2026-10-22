/**
 * weave-ui's live-update hub (weave ADR-0245 §4): ONE upstream subscription to weave's `GET /api/v1/changes`, resumed
 * with Last-Event-ID, fanned out to every browser as bare view names. A refused resume tells every browser to refresh
 * every view once; a browser that stops reading is dropped. node: built-ins only.
 */

/** The event name that tells every browser to refresh every view once. */
export const RESYNC_EVENT = "all";

/** The slice of node's ServerResponse the hub writes to. */
export interface SseSink {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  readonly writableLength: number;
  end(): void;
  destroy(): void;
  on(event: "close", fn: () => void): unknown;
}

/** WeaveClient satisfies this; rejections carry a numeric `status` (0 when weave gave no HTTP answer). */
export interface ChangesSource {
  changes(lastEventId?: string): Promise<NodeJS.ReadableStream & { destroy(err?: Error): unknown }>;
}

export interface ChangesHubOptions {
  source: ChangesSource;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  heartbeatMs?: number;
  maxClientBuffer?: number;
  log?: (line: string) => void;
}

export interface ChangesHub {
  start(): void;
  stop(): Promise<void>;
  attach(sink: SseSink): void;
  readonly clients: number;
  readonly lastEventId: string | undefined;
  readonly upstreamConnected: boolean;
}

type Upstream = NodeJS.ReadableStream & { destroy(err?: Error): unknown };

const EVENT_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const VIEW_NAME = /^[A-Za-z0-9._:-]{1,140}$/;

const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

const statusOf = (e: unknown): number => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : 0;
};

const describe = (e: unknown): string => {
  const code = (e as { code?: unknown } | null)?.code;
  return `status ${statusOf(e)}${typeof code === "string" ? ` (${code})` : ""}`;
};

export function createChangesHub(opts: ChangesHubOptions): ChangesHub {
  const minBackoff = opts.minBackoffMs ?? 500;
  const maxBackoff = opts.maxBackoffMs ?? 30000;
  const heartbeatMs = opts.heartbeatMs ?? 15000;
  const maxClientBuffer = opts.maxClientBuffer ?? 262144;
  const log = (line: string): void => {
    try {
      opts.log?.(line);
    } catch {
      /* logging never breaks the hub */
    }
  };

  const sinks = new Set<SseSink>();
  let started = false;
  let stopped = false;
  let lastEventId: string | undefined;
  let upstream: Upstream | undefined;
  let backoff = minBackoff;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let heartbeat: NodeJS.Timeout | undefined;

  const drop = (sink: SseSink): void => {
    sinks.delete(sink);
    try {
      sink.destroy();
    } catch {
      /* already gone */
    }
  };

  const push = (sink: SseSink, chunk: string): void => {
    try {
      sink.write(chunk);
    } catch {
      drop(sink);
      return;
    }
    if (sink.writableLength > maxClientBuffer) drop(sink);
  };

  const broadcast = (chunk: string): void => {
    for (const sink of [...sinks]) push(sink, chunk);
  };

  const ensureHeartbeat = (): void => {
    if (heartbeat !== undefined || stopped) return;
    heartbeat = setInterval(() => broadcast(":hb\n\n"), heartbeatMs);
    heartbeat.unref();
  };

  const onFrame = (fields: { id?: string; event?: string; data?: string }): void => {
    if (fields.id !== undefined && EVENT_ID.test(fields.id)) lastEventId = fields.id;
    const name = fields.event ?? fields.data;
    if (name === undefined || !VIEW_NAME.test(name)) return;
    broadcast(`event: ${name}\ndata: ${name}\n\n`);
  };

  const consume = (stream: Upstream): void => {
    upstream = stream;
    backoff = minBackoff;
    let buf = "";
    let frame: { id?: string; event?: string; data?: string } = {};
    let hasField = false;
    let done = false;
    const finish = (why: string): void => {
      if (done) return;
      done = true;
      if (upstream === stream) upstream = undefined;
      if (stopped) return;
      log(`changes: upstream ${why}; reconnecting`);
      schedule(backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    };
    const line = (l: string): void => {
      if (l === "") {
        if (hasField) onFrame(frame);
        frame = {};
        hasField = false;
        return;
      }
      if (l.startsWith(":")) return;
      const i = l.indexOf(":");
      const field = i === -1 ? l : l.slice(0, i);
      let value = i === -1 ? "" : l.slice(i + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "id") frame.id = value;
      else if (field === "event") frame.event = value;
      else if (field === "data") frame.data = frame.data === undefined ? value : `${frame.data}\n${value}`;
      else return;
      hasField = true;
    };
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string | Buffer) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        let l = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (l.endsWith("\r")) l = l.slice(0, -1);
        line(l);
      }
    });
    stream.on("end", () => finish("ended"));
    stream.on("close", () => finish("closed"));
    stream.on("error", () => finish("failed"));
  };

  const connect = (): void => {
    reconnectTimer = undefined;
    if (stopped) return;
    const resumeFrom = lastEventId;
    let p: Promise<Upstream>;
    try {
      p = opts.source.changes(...(resumeFrom !== undefined ? [resumeFrom] : []));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (stream) => {
        if (stopped) {
          try {
            stream.destroy();
          } catch {
            /* ignore */
          }
          return;
        }
        consume(stream);
      },
      (e: unknown) => {
        if (stopped) return;
        const status = statusOf(e);
        if (resumeFrom !== undefined && status >= 400) {
          log(`changes: resume refused (${describe(e)}); telling browsers to refresh everything`);
          broadcast(`event: ${RESYNC_EVENT}\ndata: ${RESYNC_EVENT}\n\n`);
          lastEventId = undefined;
          schedule(0);
          return;
        }
        log(`changes: subscribe failed (${describe(e)}); retrying in ${backoff}ms`);
        schedule(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      },
    ).catch(() => {
      /* never throw out of the reconnect loop */
    });
  };

  const schedule = (ms: number): void => {
    if (stopped || reconnectTimer !== undefined) return;
    reconnectTimer = setTimeout(connect, ms);
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      ensureHeartbeat();
      connect();
    },
    async stop() {
      stopped = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      heartbeat = undefined;
      const s = upstream;
      upstream = undefined;
      if (s !== undefined) {
        try {
          s.destroy();
        } catch {
          /* ignore */
        }
      }
      for (const sink of sinks) {
        try {
          sink.end();
        } catch {
          /* ignore */
        }
      }
      sinks.clear();
    },
    attach(sink) {
      try {
        sink.writeHead(200, { ...SSE_HEADERS });
      } catch {
        drop(sink);
        return;
      }
      if (stopped) {
        try {
          sink.end();
        } catch {
          /* ignore */
        }
        return;
      }
      sinks.add(sink);
      sink.on("close", () => {
        sinks.delete(sink);
      });
      push(sink, "retry: 3000\n\n");
      ensureHeartbeat();
    },
    get clients() {
      return sinks.size;
    },
    get lastEventId() {
      return lastEventId;
    },
    get upstreamConnected() {
      return upstream !== undefined;
    },
  };
}
