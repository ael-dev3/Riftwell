import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fail } from './errors.mjs';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function registerStatic(app, config) {
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = new URL(request.url, config.origin).pathname;
    if (
      pathname.startsWith('/api/') ||
      pathname.startsWith('/health/') ||
      !['GET', 'HEAD'].includes(request.method)
    )
      fail(404, 'NOT_FOUND', 'The resource was not found.');
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      fail(400, 'INVALID_PATH', 'The request path is invalid.');
    }
    if (
      decoded.includes('\0') ||
      decoded.includes('\\') ||
      decoded.split('/').some((part) => part === '..' || part.startsWith('.'))
    )
      fail(404, 'NOT_FOUND', 'The resource was not found.');
    let root;
    try {
      root = await realpath(config.distPath);
    } catch {
      fail(
        503,
        'FRONTEND_UNAVAILABLE',
        'The application build is unavailable.',
      );
    }
    const file =
      decoded === '/' || !extname(decoded) ? 'index.html' : decoded.slice(1);
    const candidate = resolve(root, file);
    if (!candidate.startsWith(root + sep))
      fail(404, 'NOT_FOUND', 'The resource was not found.');
    let path;
    let info;
    try {
      path = await realpath(candidate);
      if (!path.startsWith(root + sep))
        fail(404, 'NOT_FOUND', 'The resource was not found.');
      info = await stat(path);
    } catch {
      fail(404, 'NOT_FOUND', 'The resource was not found.');
    }
    if (!info.isFile() || !types[extname(path)])
      fail(404, 'NOT_FOUND', 'The resource was not found.');
    const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    const immutable = /^assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(file);
    reply.header(
      'cache-control',
      immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    reply.header('etag', etag);
    reply.header('last-modified', info.mtime.toUTCString());
    if (request.headers['if-none-match'] === etag)
      return reply.code(304).send();
    reply.type(types[extname(path)]);
    reply.header('content-length', info.size);
    if (request.method === 'HEAD') return reply.send();
    return reply.send(createReadStream(path));
  });
}
