/** Tiny static server for test/pages (manual testing and the e2e test). */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/pages');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// no-store: edits to the test pages show up on a plain reload.
const HEADERS = { 'cache-control': 'no-store' };
export function serve(port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '') || 'index.html';
    const file = path.join(pagesDir, rel);
    if (!file.startsWith(pagesDir)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { ...HEADERS, 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404, HEADERS).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 5179);
  await serve(port);
  console.log(`Test pages: http://127.0.0.1:${port}/`);
}
