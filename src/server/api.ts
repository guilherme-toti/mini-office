import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  API_EVENTS_PATH,
  SNAPSHOT_EVENT,
  SourceNameSchema,
  type SourceName,
} from '../shared/protocol.ts';
import { ClaudeSource } from './claude/claude-source.ts';
import { DemoSource } from './demo/demo-source.ts';
import type { PollingSource } from './source.ts';

const HEARTBEAT_MS = 15_000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/**
 * The office stream describes your projects and sessions, so it only answers requests addressed
 * to this machine by name; a DNS-rebinding page arrives with its own host name and is refused.
 */
export function isLocalHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
  return LOCAL_HOSTS.has(host ?? '');
}

function reply(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error }));
}

/** `/api/events?source=live|demo` streams office snapshots over SSE. */
export function createOfficeApi(): Middleware {
  const sources: Record<SourceName, PollingSource> = {
    live: new ClaudeSource(),
    demo: new DemoSource(),
  };

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== API_EVENTS_PATH) {
      next();
      return;
    }
    if (!isLocalHost(req.headers.host)) {
      reply(res, 403, 'forbidden host');
      return;
    }
    const parsed = SourceNameSchema.safeParse(url.searchParams.get('source') ?? 'live');
    if (!parsed.success) {
      reply(res, 400, 'unknown source');
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    const unsubscribe = sources[parsed.data].subscribe((snapshot) => {
      res.write(`event: ${SNAPSHOT_EVENT}\ndata: ${JSON.stringify(snapshot)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
}
