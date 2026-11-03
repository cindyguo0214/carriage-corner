// HTTP 路由：POST /api/ticket、GET /t/:token、GET /og/t/:token.png
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Limiter } from '../limiter';
import { renderLanding, renderOgImage, TicketSchema, type TicketSigner } from './ticket';

const MAX_BODY = 4096;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const send = (res: ServerResponse, status: number, type: string, body: string | Buffer, cache = 'no-store') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  res.end(body);
};

/** 公開網址：正式環境以 PUBLIC_ORIGIN 指定；開發時沿用請求的 Host（經 Vite proxy 時是前端的網址） */
function originOf(req: IncomingMessage) {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/$/, '');
  const first = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h)?.split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) ?? 'http';
  const host = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}

/** 回傳 true 代表這個請求已處理 */
export async function handleTicketRoutes(
  req: IncomingMessage, res: ServerResponse, signer: TicketSigner, limiter: Limiter,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x');

  if (req.method === 'POST' && url.pathname === '/api/ticket') {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (!limiter.take(`ticket:${ip}`, 30, 3_600_000)) {
      send(res, 429, 'application/json', JSON.stringify({ error: 'RATE_LIMITED' }));
      return true;
    }
    try {
      const parsed = TicketSchema.safeParse(await readJson(req));
      if (!parsed.success) {
        send(res, 400, 'application/json', JSON.stringify({ error: 'BAD_REQUEST' }));
        return true;
      }
      send(res, 200, 'application/json', JSON.stringify({ token: signer.sign(parsed.data) }));
    } catch {
      send(res, 400, 'application/json', JSON.stringify({ error: 'BAD_REQUEST' }));
    }
    return true;
  }

  const og = url.pathname.match(/^\/og\/t\/([A-Za-z0-9_.-]+)\.png$/);
  if (req.method === 'GET' && og) {
    const t = signer.verify(og[1]);
    if (!t) send(res, 404, 'text/plain; charset=utf-8', 'not found');
    // token 內容即簽章，同一個網址的圖片永遠相同，可長期快取
    else send(res, 200, 'image/png', renderOgImage(t), 'public, max-age=31536000, immutable');
    return true;
  }

  const landing = url.pathname.match(/^\/t\/([A-Za-z0-9_.-]+)$/);
  if (req.method === 'GET' && landing) {
    const t = signer.verify(landing[1]);
    if (!t) {
      res.writeHead(302, { location: '/' }).end();
      return true;
    }
    send(res, 200, 'text/html; charset=utf-8', renderLanding(t, landing[1], originOf(req)), 'public, max-age=300');
    return true;
  }

  return false;
}
