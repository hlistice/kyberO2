import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { evaluateImage, GameError, validateInput } from './lib/evaluate.mjs';

const MAX_BODY = 7 * 1024 * 1024;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
const commonHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'",
};

function json(response, status, body, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { ...commonHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    let rejected = false;
    let chunks = [];
    request.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        rejected = true; chunks = [];
        rejectBody(new GameError(413, 'Obrázek je příliš velký. Nahraj menší soubor.'));
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { rejectBody(new GameError(400, 'Centrála nedokázala přečíst odeslaný případ. Zkus to znovu.')); }
    });
    request.on('error', () => rejectBody(new GameError(400, 'Odesílání případu se přerušilo.')));
  });
}

function isSameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!request.headers.origin) return true;
  try {
    const origin = new URL(request.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === request.headers.host;
  } catch { return false; }
}

export function createGameServer({
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  evaluator = evaluateImage,
  perMinuteLimit = 30,
} = {}) {
  const rateLimits = new Map();
  const evaluations = new Map();
  let active = 0;

  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://game.local').pathname;
      if (pathname === '/api/config') {
        if (request.method !== 'GET') return json(response, 405, { error: 'Použij metodu GET.' }, { Allow: 'GET' });
        return json(response, 200, { configured: Boolean(apiKey.trim()) });
      }
      if (pathname === '/api/evaluate') {
        if (request.method !== 'POST') return json(response, 405, { error: 'Použij metodu POST.' }, { Allow: 'POST' });
        if (!isSameOrigin(request)) throw new GameError(403, 'Odesílání je povolené jen z této hry.');
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new GameError(415, 'Případ musí být odeslaný jako JSON.');
        if (Number(request.headers['content-length']) > MAX_BODY) { request.resume(); throw new GameError(413, 'Obrázek je příliš velký. Nahraj menší soubor.'); }
        if (!apiKey.trim()) { request.resume(); throw new GameError(503, 'AI vyšetřovatel zatím není nastavený. Požádej správce hry o připojení AI.'); }
        const now = Date.now();
        for (const [ip, rate] of rateLimits) if (rate.expires <= now) rateLimits.delete(ip);
        for (const [id, cached] of evaluations) if (!cached.pending && cached.expires <= now) evaluations.delete(id);
        const address = request.socket.remoteAddress || 'local';
        if (rateLimits.size >= 2048 && !rateLimits.has(address)) { request.resume(); throw new GameError(503, 'Centrála má právě plno. Zkus to za chvíli.'); }
        const rate = rateLimits.get(address) || { count: 0, expires: now + 60_000 };
        rate.count += 1;
        rateLimits.set(address, rate);
        if (rate.count > perMinuteLimit) { request.resume(); return json(response, 429, { error: 'Příliš mnoho pokusů najednou. Počkej minutu a zkus to znovu.' }, { 'Retry-After': '60' }); }
        const input = validateInput(await readJson(request));
        const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        let cached = evaluations.get(input.caseId);
        if (cached && cached.digest !== digest) throw new GameError(409, 'Tento případ už se vyhodnocuje nebo byl uzavřen. Při opakování odešli původní tip beze změny, nebo nahraj další obrázek.');
        if (!cached) {
          if (active >= 4) throw new GameError(503, 'Vyšetřovatelé právě řeší jiné případy. Zkus to za chvíli znovu.');
          if (evaluations.size >= 256) {
            const oldest = [...evaluations].find(([, entry]) => !entry.pending);
            if (oldest) evaluations.delete(oldest[0]);
          }
          active += 1;
          cached = { digest, expires: now + 600_000, pending: true };
          const entry = cached;
          // Stejný opakovaný požadavek sdílí výsledek i rozpracované volání API.
          entry.promise = Promise.resolve().then(() => evaluator(input, { apiKey, model, baseUrl }))
            .then((result) => { entry.expires = Date.now() + 600_000; return result; })
            .catch((error) => { if (evaluations.get(input.caseId) === entry) evaluations.delete(input.caseId); throw error; })
            .finally(() => { active -= 1; entry.pending = false; });
          evaluations.set(input.caseId, entry);
        }
        return json(response, 200, await cached.promise);
      }
      const asset = staticFiles.get(pathname);
      if (!asset) return json(response, 404, { error: 'Tady žádná stopa není.' });
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Použij metodu GET.' }, { Allow: 'GET, HEAD' });
      const content = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, { ...commonHeaders, 'Content-Type': asset[1], 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const known = error instanceof GameError;
      if (!known) console.error('Požadavek se nepodařilo zpracovat. Obsah případu se neloguje.');
      json(response, known ? error.status : 500, { error: known ? error.message : 'Na centrále nastala chyba. Zkus to za chvíli znovu.' });
    }
  });
  server.requestTimeout = 65_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT musí být celé číslo od 1 do 65535.');
    process.exitCode = 1;
  } else {
    const server = createGameServer();
    server.on('error', () => { console.error('Server se nepodařilo spustit. Ověř HOST, PORT a dostupnost portu.'); process.exitCode = 1; });
    server.listen(port, host, () => console.log(`Detektiv obrazů běží na http://${host}:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  }
}
