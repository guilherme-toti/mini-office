import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createOfficeApi } from './api.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4321);
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

function decodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/** Resolves a request to a file in dist, falling back to index.html; never leaves dist. */
async function findFile(decoded: string): Promise<{ path: string; type: string } | null> {
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  for (const path of [join(DIST, relative), join(DIST, 'index.html')]) {
    if (!path.startsWith(DIST)) continue;
    try {
      if ((await stat(path)).isFile())
        return { path, type: TYPES[extname(path)] ?? 'application/octet-stream' };
    } catch {
      // Not there; try the next candidate.
    }
  }
  return null;
}

function plain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(text);
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const decoded = decodePath(pathname);
  if (decoded === null) {
    plain(res, 400, 'Bad request');
    return;
  }
  const file = await findFile(decoded);
  if (!file) {
    plain(res, 404, 'Run `pnpm build` first.');
    return;
  }
  res.writeHead(200, { 'content-type': file.type });
  await pipeline(createReadStream(file.path), res);
}

const api = createOfficeApi();

createServer((req, res) => {
  api(req, res, () => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    serveStatic(pathname, res).catch((error: unknown) => {
      // A file can vanish mid-read during a rebuild; drop that one response, keep the server.
      console.error('[mini-office] static file failed', error);
      if (!res.headersSent) plain(res, 500, 'Something went wrong');
      else res.destroy();
    });
  });
}).listen(PORT, HOST, () => {
  console.log(`Mini Office is open at http://${HOST}:${PORT}`);
});
