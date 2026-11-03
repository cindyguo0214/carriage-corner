// 車票分享連結（docs/PRD.md §8.3）：無狀態的簽章 token、落地頁、OG 預覽圖
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  companionLine, LINES, OPERATOR, PASS_CARDS, quoteOf, stationByCode, taipeiParts, ticketSerial,
  type LineId, type SeatId, type TicketStats,
} from '@cc/shared';
import { drawText, textWidth } from './font';
import { Bitmap } from './png';

const DAY = 86_400_000;

const TicketFields = z.object({
  line: z.enum(['CX', 'RV', 'SK']),
  from: z.string().regex(/^[A-Z]{2}\d{2}$/),
  to: z.string().regex(/^[A-Z]{2}\d{2}$/),
  seat: z.string().regex(/^[1-6][AB]$/).transform(s => s as SeatId),
  boardedAt: z.number().int(),
  minutes: z.number().int().min(1).max(24 * 60),
  pomodoros: z.number().int().min(0).max(99),
  coffee: z.number().int().min(0).max(999),
  cheers: z.number().int().min(0).max(999),
  coRiders: z.number().int().min(0).max(9999),
  quote: z.number().int().min(0).max(99),
  mode: z.enum(['morning', 'night']),
  card: z.enum(['tile', 'boba', 'ricecooker', 'mangoice']),
  room: z.string().regex(/^(CX|RV|SK)-\d{4}$/),
});

export const TicketSchema = TicketFields
  .refine(t => stationByCode(t.line, t.from) && stationByCode(t.line, t.to), '站碼不屬於這條路線')
  .refine(t => t.boardedAt > Date.now() - 2 * DAY && t.boardedAt < Date.now() + 5 * 60_000, '上車時間不合理');

export class TicketSigner {
  private key: string;

  constructor(secret: string) {
    this.key = `${secret}:ticket`;
  }

  sign(t: TicketStats): string {
    const payload = Buffer.from(JSON.stringify(pack(t))).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  /** 簽章正確才解開；不再檢查上車時間：舊車票連結要能一直打開 */
  verify(token: string): TicketStats | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig || payload.length > 1024) return null;
    const expected = Buffer.from(this.mac(payload));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      return unpack(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    } catch {
      return null;
    }
  }

  private mac(payload: string) {
    return createHmac('sha256', this.key).update(payload).digest('base64url').slice(0, 32);
  }
}

// 分享連結越短越好：以陣列取代物件鍵名、時間以秒為單位的 36 進位表示，長度約為 JSON 物件的一半
const CARDS = ['tile', 'boba', 'ricecooker', 'mangoice'] as const;
type Packed = [1, string, string, string, string, string, number, number, number, number, number, number, 0 | 1, number, string];

function pack(t: TicketStats): Packed {
  return [
    1, t.line, t.from.slice(2), t.to.slice(2), t.seat, Math.floor(t.boardedAt / 1000).toString(36),
    t.minutes, t.pomodoros, t.coffee, t.cheers, t.coRiders, t.quote, t.mode === 'night' ? 1 : 0,
    CARDS.indexOf(t.card), t.room.slice(3),
  ];
}

function unpack(a: Packed): TicketStats | null {
  if (!Array.isArray(a) || a[0] !== 1) return null;
  const [, line, from, to, seat, boarded, minutes, pomodoros, coffee, cheers, coRiders, quote, night, card, room] = a;
  const parsed = TicketFields.safeParse({
    line, from: `${line}${from}`, to: `${line}${to}`, seat, boardedAt: parseInt(boarded, 36) * 1000,
    minutes, pomodoros, coffee, cheers, coRiders, quote, mode: night ? 'night' : 'morning', card: CARDS[card], room: `${line}-${room}`,
  });
  return parsed.success && stationByCode(parsed.data.line, parsed.data.from) && stationByCode(parsed.data.line, parsed.data.to)
    ? parsed.data
    : null;
}

// ── OG 預覽圖：1200×630，像素畫在 240×126 再放大 5 倍 ──

const OG = {
  morning: { outside: '#D6CDBE', paper: '#F1ECE3', shadow: '#BDB3A4', ink: '#4A4744', muted: '#8B857D', dash: '#CFC6B8' },
  night: { outside: '#26242E', paper: '#3A3846', shadow: '#1C1B22', ink: '#E9E2D6', muted: '#A39C93', dash: '#57536A' },
} as const;
const LIGHT = '#F7F2EA';

export function renderOgImage(t: TicketStats): Buffer {
  const pal = OG[t.mode];
  const line = LINES[t.line as LineId];
  const from = stationByCode(t.line, t.from)!;
  const to = stationByCode(t.line, t.to)!;
  const b = new Bitmap(240, 126);

  b.rect(0, 0, 240, 126, pal.outside);
  b.rect(10, 10, 224, 110, pal.shadow);
  b.rect(8, 8, 224, 110, pal.paper);
  b.rect(8, 8, 224, 16, line.color);
  drawText(b, `${line.id} ${line.en}`, 14, 13, LIGHT);
  // TPRT 幾何 T 字標誌
  b.rect(214, 11, 12, 2, LIGHT);
  b.rect(218, 13, 4, 9, LIGHT);
  for (const dy of [14, 16, 18, 20]) { b.rect(216, dy, 1, 1, LIGHT); b.rect(223, dy, 1, 1, LIGHT); }

  const nameScale = (s: string) => (textWidth(s, 2) <= 136 ? 2 : 1);
  drawText(b, from.en, 16, 32, pal.ink, nameScale(from.en));
  drawText(b, '>', 16, 50, pal.muted, 2);
  drawText(b, to.en, 16, 66, pal.ink, nameScale(to.en));

  drawText(b, 'SEAT', 168, 32, pal.muted);
  drawText(b, t.seat, 168, 42, pal.ink, 3);
  drawText(b, `${t.minutes} MIN`, 168, 70, pal.ink);

  // 撕線
  b.rect(0, 84, 8, 6, pal.outside);
  for (let x = 14; x < 228; x += 5) b.rect(x, 86, 3, 1, pal.dash);
  b.rect(8, 84, 2, 6, pal.outside);
  b.rect(230, 84, 2, 6, pal.outside);

  drawText(b, `FOCUS X${t.pomodoros}  COFFEE X${t.coffee}  CHEER X${t.cheers}`, 16, 94, pal.ink);
  const p = taipeiParts(t.boardedAt);
  const date = `${p.y}.${String(p.mo).padStart(2, '0')}.${String(p.d).padStart(2, '0')}`;
  drawText(b, `CARRIAGE CORNER - ${OPERATOR.en}`, 16, 106, pal.muted);
  drawText(b, date, 226 - textWidth(date), 106, pal.muted);

  return b.scale(5).toPng();
}

// ── 落地頁 ──

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderLanding(t: TicketStats, token: string, origin: string): string {
  const line = LINES[t.line];
  const from = stationByCode(t.line, t.from)!;
  const to = stationByCode(t.line, t.to)!;
  const p = taipeiParts(t.boardedAt);
  const night = t.mode === 'night';
  const title = `${line.zh} ${from.zh} → ${to.zh}｜車廂角落`;
  const desc = `${companionLine(t.coRiders)}。「${quoteOf(t)}」`;
  const image = `${origin}/og/t/${token}.png`;
  const join = `/?line=${t.line}`;

  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(`${origin}/t/${token}`)}">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root { --bg:${night ? '#26242E' : '#D6CDBE'}; --paper:${night ? '#3A3846' : '#F1ECE3'}; --ink:${night ? '#E9E2D6' : '#4A4744'}; --muted:${night ? '#A39C93' : '#8B857D'}; --accent:${night ? '#D9B98C' : '#B97A6F'}; --line:${line.color}; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; background:var(--bg); color:var(--ink);
    font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif; }
  main { width:min(420px,100%); }
  .ticket { background:var(--paper); border-radius:6px; overflow:hidden; box-shadow:4px 4px 0 rgba(0,0,0,.18); }
  .band { background:var(--line); color:#F7F2EA; padding:12px 18px; display:flex; justify-content:space-between; font-weight:700; }
  .band small { font-weight:400; opacity:.9; }
  .body { padding:18px; }
  .route { display:flex; justify-content:space-between; align-items:baseline; gap:12px; font-size:30px; font-weight:700; margin:6px 0 2px; }
  .en { display:flex; justify-content:space-between; color:var(--muted); font-size:13px; }
  .row { display:flex; justify-content:space-between; margin-top:14px; font-size:15px; }
  .cut { border-top:2px dashed var(--muted); opacity:.4; margin:18px -18px; }
  .quote { color:var(--accent); font-weight:700; margin:10px 0 0; line-height:1.6; }
  .muted { color:var(--muted); font-size:14px; }
  a.join { display:block; text-align:center; margin-top:18px; padding:14px; border-radius:6px; background:#E6C9A8; color:#4A4744;
    font-size:17px; letter-spacing:.1em; text-decoration:none; box-shadow:0 4px 0 #c9a77f; }
  a.join:focus-visible { outline:3px solid var(--accent); outline-offset:2px; }
  .legal { text-align:center; font-size:11px; color:var(--muted); margin-top:14px; line-height:1.5; }
</style>
</head>
<body>
<main>
  <article class="ticket" aria-label="北城捷運車票">
    <div class="band"><span>${esc(line.id)} ${esc(line.zh)}</span><small>${esc(OPERATOR.zh)} ${esc(OPERATOR.en)}</small></div>
    <div class="body">
      <div class="muted">單程票 ONE-WAY TICKET</div>
      <div class="route"><span>${esc(from.zh)}</span><span aria-hidden="true">→</span><span>${esc(to.zh)}</span></div>
      <div class="en"><span>${esc(from.en)}</span><span>${esc(to.en)}</span></div>
      <div class="row"><span>座位 <b>${esc(t.seat)}</b></span><span>隨行卡・${esc(PASS_CARDS[t.card].zh)}</span></div>
      <div class="row"><span>${p.y}.${String(p.mo).padStart(2, '0')}.${String(p.d).padStart(2, '0')}（${p.wd}）${p.hh}:${p.mm} 上車</span><span>${t.minutes} 分鐘</span></div>
      <div class="cut"></div>
      <div>📖 專注 ×${t.pomodoros}　☕ ×${t.coffee}　👏 ×${t.cheers}</div>
      <p class="muted">${esc(companionLine(t.coRiders))}</p>
      <p class="quote">「${esc(quoteOf(t))}」</p>
      <p class="muted">No. ${esc(ticketSerial(t))}</p>
    </div>
  </article>
  <a class="join" href="${esc(join)}">搭上同一條線</a>
  <p class="legal">不需註冊・完全匿名・沒有聊天室<br>本作為獨立原創作品，路線、站名、標誌與票證皆為虛構，與任何真實營運單位無關。</p>
</main>
</body>
</html>`;
}
