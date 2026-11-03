import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { inflateSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import type { TicketStats } from '@cc/shared';
import { createRealtimeServer, type RealtimeServer } from '../src/app';
import type { Config } from '../src/config';

const cfg: Config = {
  port: 0, webOrigin: '*', runSec: [60, 60], dwellSec: 10, graceSec: 60, noteTtlSec: 60, npcWarmth: 4,
  tokenSecret: 'ticket-test-secret',
};

let server: RealtimeServer;
let base: string;

before(async () => {
  server = createRealtimeServer(cfg);
  await new Promise<void>(resolve => server.http.listen(0, resolve));
  base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
});
after(() => server.close());

const ticket = (patch: Partial<TicketStats> = {}): TicketStats => ({
  line: 'RV', from: 'RV01', to: 'RV04', seat: '3B', boardedAt: Date.now() - 47 * 60_000, minutes: 47,
  pomodoros: 2, received: { beep: 1, wave: 0, blanket: 2, fortune: 1 }, fortune: 3, coRiders: 7, quote: 1, mode: 'night', card: 'boba', room: 'RV-0042',
  ...patch,
});

const sign = (body: unknown) =>
  fetch(`${base}/api/ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** 解開 PNG：回傳寬高，並確認 IDAT 解壓後的長度正確 */
function decodePng(buf: Buffer) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  let width = 0, height = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, (width * 4 + 1) * height);
  return { width, height };
}

describe('ticket share links', () => {
  it('簽章後可打開落地頁，含 OG 標籤與車票內容', async () => {
    const res = await sign(ticket());
    assert.equal(res.status, 200);
    const { token } = (await res.json()) as { token: string };

    const page = await fetch(`${base}/t/${token}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(`<meta property="og:image" content="${base}/og/t/${token}.png">`), 'og:image 應為絕對網址');
    assert.match(html, /河岸線/);
    assert.match(html, /中央站/);
    assert.match(html, /芝蘭/);
    assert.match(html, /和 7 位陌生人安靜地同行了一段路/);
    assert.match(html, /href="\/\?line=RV"/);
  });

  it('經反向代理時，og:image 用對外網址；分享連結夠短', async () => {
    const { token } = (await (await sign(ticket())).json()) as { token: string };
    assert.ok(token.length < 200, `token 太長：${token.length}`);
    const html = await (await fetch(`${base}/t/${token}`, {
      headers: { 'x-forwarded-host': 'carriage.example', 'x-forwarded-proto': 'https' },
    })).text();
    assert.ok(html.includes(`content="https://carriage.example/og/t/${token}.png"`));
  });

  it('OG 預覽圖是 1200×630 的合法 PNG，且可長期快取', async () => {
    const { token } = (await (await sign(ticket({ mode: 'morning', to: 'RV07' }))).json()) as { token: string };
    const res = await fetch(`${base}/og/t/${token}.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control') ?? '', /immutable/);
    assert.deepEqual(decodePng(Buffer.from(await res.arrayBuffer())), { width: 1200, height: 630 });
  });

  it('竄改過的 token：落地頁導回首頁、預覽圖 404', async () => {
    const { token } = (await (await sign(ticket())).json()) as { token: string };
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...ticket(), pomodoros: 99 })).toString('base64url');
    for (const bad of [`${forged}.${sig}`, `${payload}.AAAA`, 'garbage']) {
      const page = await fetch(`${base}/t/${bad}`, { redirect: 'manual' });
      assert.equal(page.status, 302);
      assert.equal((await fetch(`${base}/og/t/${bad}.png`)).status, 404);
    }
  });

  it('拒絕不合理的車票內容', async () => {
    for (const bad of [
      ticket({ to: 'CX03' }), // 站碼不屬於這條線
      ticket({ boardedAt: Date.now() - 3 * 86_400_000 }), // 三天前上車
      ticket({ minutes: 0 }),
      { ...ticket(), seat: '7C' },
      { ...ticket(), note: '<script>' }, // 多餘欄位不會被簽進去，但 seat 等仍需合法
    ]) {
      const res = await sign(bad);
      if ('note' in bad) {
        assert.equal(res.status, 200);
        const { token } = (await res.json()) as { token: string };
        assert.ok(!Buffer.from(token.split('.')[0], 'base64url').toString().includes('script'), '使用者文字不得進入公開連結');
      } else {
        assert.equal(res.status, 400, JSON.stringify(bad));
      }
    }
  });
});
