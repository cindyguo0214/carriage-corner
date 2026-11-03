// 車票明信片繪製（docs/PRD.md §8.1）：1080×1350（4:5，Threads 動態牆直式甜蜜點）
// 像素圖層畫在 216×270，再以 Nearest 放大 5 倍；文字直接畫在全解析度上保持清晰。
import qrcode from 'qrcode-generator';
import {
  companionLine, LINES, OPERATOR, PASS_CARDS, quoteOf, stationByCode, taipeiParts, ticketSerial,
  type Mode, type PassCardId, type TicketStats,
} from '@cc/shared';
import { makeCanvas, mix, Painter } from '../game/paint';

export const TICKET_W = 1080;
export const TICKET_H = 1350;
const S = 5;
const BW = TICKET_W / S;
const BH = TICKET_H / S;
const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Segoe UI Emoji", "Apple Color Emoji", sans-serif';

interface TicketPalette { outside: string; paper: string; shadow: string; ink: string; muted: string; dash: string; accent: string }

const PALETTE: Record<Mode, TicketPalette> = {
  // 晨間版：燕麥紙感
  morning: { outside: '#D6CDBE', paper: '#F1ECE3', shadow: '#BDB3A4', ink: '#4A4744', muted: '#8B857D', dash: '#CFC6B8', accent: '#B97A6F' },
  // 夜間版：煙紫＋暖燈黃字
  night: { outside: '#26242E', paper: '#3A3846', shadow: '#1C1B22', ink: '#E9E2D6', muted: '#A39C93', dash: '#57536A', accent: '#D9B98C' },
};

export interface TicketView {
  stats: TicketStats;
  shareUrl: string;
  /** 只印在本機圖片上，不進公開連結 */
  note: string | null;
}

export async function renderTicket(view: TicketView): Promise<Blob> {
  const canvas = drawTicket(view);
  await document.fonts?.ready;
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('ticket render failed'))), 'image/png'),
  );
}

export function drawTicket({ stats, shareUrl, note }: TicketView): HTMLCanvasElement {
  const pal = PALETTE[stats.mode];
  const line = LINES[stats.line];
  const from = stationByCode(stats.line, stats.from);
  const to = stationByCode(stats.line, stats.to);

  // ── 像素圖層 ──
  const pix = makeCanvas(BW, BH);
  drawPixels(new Painter(pix.ctx), pal, line.color, stats.card, stats.mode);

  const { canvas, ctx } = makeCanvas(TICKET_W, TICKET_H);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pix.canvas, 0, 0, TICKET_W, TICKET_H);

  const text = (s: string, x: number, y: number, size: number, color: string, opts: { bold?: boolean; align?: CanvasTextAlign } = {}) => {
    ctx.font = `${opts.bold ? '700 ' : ''}${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = opts.align ?? 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  };
  const L = 120;
  const R = 960;

  // 路線色帶
  text(`${line.id} ${line.zh}`, L, 125, 46, '#F7F2EA', { bold: true });
  text(`${OPERATOR.zh} ${OPERATOR.en}`, 910, 125, 28, '#F7F2EA', { align: 'right' });

  text('單程票', L, 240, 40, pal.ink, { bold: true });
  text('ONE-WAY TICKET', R, 240, 28, pal.muted, { align: 'right' });

  // 起訖站
  text(from?.zh ?? stats.from, L, 350, 92, pal.ink, { bold: true });
  text(to?.zh ?? stats.to, R, 350, 92, pal.ink, { bold: true, align: 'right' });
  text(from?.en ?? '', L, 430, 30, pal.muted);
  text(to?.en ?? '', R, 430, 30, pal.muted, { align: 'right' });

  // 隨行卡與座位
  text('隨行卡 PassCard', 350, 512, 28, pal.muted);
  text(PASS_CARDS[stats.card].zh, 350, 568, 40, pal.ink, { bold: true });
  // 站著拉吊環的人：S3 → 站位 3
  const standing = stats.seat.startsWith('S');
  text(standing ? '站位' : '座位', R, 505, 28, pal.muted, { align: 'right' });
  text(standing ? stats.seat.slice(1) : stats.seat, R, 568, 84, pal.ink, { bold: true, align: 'right' });

  // 日期與乘車時間（台北時間）
  const on = taipeiParts(stats.boardedAt);
  const off = taipeiParts(stats.boardedAt + stats.minutes * 60_000);
  text(`日期　${on.y}.${String(on.mo).padStart(2, '0')}.${String(on.d).padStart(2, '0')}（${on.wd}）`, L, 660, 36, pal.ink);
  text(stats.mode === 'night' ? '🌃 夜間班次' : '🌅 晨間班次', R, 660, 36, pal.ink, { align: 'right' });
  text(`乘車　${on.hh}:${on.mm} → ${off.hh}:${off.mm}（${stats.minutes} 分）`, L, 740, 36, pal.ink);

  // 撕線以下：這段旅程
  text(`📖 專注 ×${stats.pomodoros}　🙂 收到微光 ×${stats.cheers}`, L, 930, 42, pal.ink);
  text(companionLine(stats.coRiders), L, 1005, 32, pal.muted);

  let y = 1085;
  for (const l of wrap(ctx, `「${quoteOf(stats)}」`, 620, `700 36px ${FONT}`)) {
    text(l, L - 18, y, 36, pal.accent, { bold: true });
    y += 52;
  }
  if (note) {
    for (const l of wrap(ctx, `你在車窗上寫下：「${note}」`, 620, `28px ${FONT}`)) {
      text(l, L, y + 6, 28, pal.muted);
      y += 42;
    }
  }

  text(`No. ${ticketSerial(stats)}`, L, 1240, 26, pal.muted);
  drawQr(ctx, shareUrl, 770, 1040, 190);

  text('車廂角落・免下載，現在就上車', TICKET_W / 2, 1315, 28, pal.muted, { align: 'center' });
  return canvas;
}

function wrap(ctx: CanvasRenderingContext2D, s: string, width: number, font: string): string[] {
  ctx.font = font;
  const lines: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (ctx.measureText(cur + ch).width > width && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(size / (n + 4));
  const total = cell * (n + 4);
  const ox = x + Math.floor((size - total) / 2);
  const oy = y + Math.floor((size - total) / 2);
  // QR 一律淺底深點，夜間版也維持可掃描的對比
  ctx.fillStyle = '#F7F2EA';
  ctx.fillRect(ox, oy, total, total);
  ctx.fillStyle = '#2C2A2E';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) ctx.fillRect(ox + (c + 2) * cell, oy + (r + 2) * cell, cell, cell);
  }
}

// ── 像素圖層 ──

function drawPixels(p: Painter, pal: TicketPalette, lineColor: string, card: PassCardId, mode: Mode) {
  p.rect(0, 0, BW, BH, pal.outside);
  // 背景的細碎光點
  for (let i = 0; i < 40; i++) {
    const x = (i * 53) % BW;
    const y = (i * 97 + 13) % BH;
    p.px(x, y, mode === 'night' ? pal.accent : pal.paper, 0.35);
  }

  // 票身（含陰影）
  p.round(14, 16, 192, 242, pal.shadow);
  p.round(12, 14, 192, 242, pal.paper);

  // 路線色帶
  p.round(12, 14, 192, 22, lineColor);
  p.rect(12, 30, 192, 6, lineColor);
  drawLogo(p, 186, 19, '#F7F2EA');

  // 起訖之間的像素箭頭
  p.rect(86, 70, 46, 1, pal.muted);
  p.rect(129, 68, 1, 5, pal.muted);
  p.rect(130, 69, 1, 3, pal.muted);
  p.px(131, 70, pal.muted);

  drawCard(p, 24, 96, card);

  // 撕線：兩側半圓缺口＋虛線
  const cut = 166;
  for (const cx of [12, 204]) {
    for (let dy = -5; dy <= 5; dy++) {
      const half = Math.floor(Math.sqrt(25 - dy * dy));
      p.rect(cx - half, cut + dy, half * 2 + 1, 1, pal.outside);
    }
  }
  for (let x = 22; x < 196; x += 5) p.rect(x, cut, 3, 1, pal.dash);

  // 撕線下方的路線色細線
  p.rect(24, 176, 30, 1, mix(lineColor, pal.paper, 0.3));
}

/** 北城捷運 TPRT 原創幾何 T 字像素標誌（docs/PRD.md §3.3） */
function drawLogo(p: Painter, x: number, y: number, color: string) {
  p.rect(x, y, 12, 2, color);
  p.rect(x + 4, y + 2, 4, 9, color);
  for (const dy of [3, 5, 7, 9]) {
    p.px(x + 2, y + dy, color);
    p.px(x + 9, y + dy, color);
  }
}

/** 隨行卡卡面（docs/PRD.md §3.4）：原創像素圖案，不含任何品牌元素 */
function drawCard(p: Painter, x: number, y: number, card: PassCardId) {
  const W = 40, H = 25;
  const bg: Record<PassCardId, string> = { tile: '#EFE6D6', boba: '#BFD3CC', ricecooker: '#C9D3DB', mangoice: '#F3E6C8' };
  p.round(x + 1, y + 1, W, H, 'rgba(0,0,0,0.18)');
  p.round(x, y, W, H, bg[card]);
  const cx = x + W / 2;
  const cy = y + H / 2;

  if (card === 'tile') {
    const colors = ['#B97A6F', '#7FA9A3', '#D4A373', '#8FA3B5'];
    [[-9, -6], [9, -6], [-9, 6], [9, 6]].forEach(([dx, dy], i) => diamond(p, cx + dx, cy + dy - 0.5, 4, colors[i]));
    diamond(p, cx, cy - 0.5, 2, '#4A4744');
    p.rect(x + 2, y + 2, W - 4, 1, '#D8CDB9');
    p.rect(x + 2, y + H - 3, W - 4, 1, '#D8CDB9');
  } else if (card === 'boba') {
    p.rect(cx + 2, y + 2, 1, 7, '#C98BA0'); // 吸管
    p.rect(cx - 6, y + 7, 13, 2, '#F3EEE6'); // 杯蓋
    for (let r = 0; r < 13; r++) {
      const inset = Math.floor(r / 5);
      p.rect(cx - 5 + inset, y + 9 + r, 11 - inset * 2, 1, r < 3 ? '#EADFCF' : '#C9A27E');
    }
    for (const [dx, dy] of [[-3, 18], [0, 19], [3, 18], [-1, 16], [2, 16], [-2, 20], [1, 20]]) p.px(cx + dx, y + dy, '#4A3B36');
  } else if (card === 'ricecooker') {
    // 通用造型電鍋：不使用任何品牌字樣與招牌花色
    p.rect(cx - 7, y + 7, 14, 2, '#E8E1D5');
    p.rect(cx - 5, y + 5, 10, 2, '#E8E1D5');
    p.rect(cx - 1, y + 3, 2, 2, '#6B6A70');
    p.rect(cx - 9, y + 9, 18, 11, '#E8E1D5');
    p.rect(cx - 9, y + 12, 18, 2, '#8FA595');
    p.rect(cx - 11, y + 11, 2, 3, '#6B6A70');
    p.rect(cx + 9, y + 11, 2, 3, '#6B6A70');
    p.rect(cx - 2, y + 16, 4, 2, '#B97A6F');
    for (const [dx, dy] of [[-3, 1], [-2, 0], [3, 1], [4, 0]]) p.px(cx + dx, y + dy + 1, '#FFFFFF', 0.8);
  } else {
    for (let r = 0; r < 6; r++) {
      const half = 12 - Math.floor(r * r / 4);
      p.rect(cx - half, y + 15 + r, half * 2, 1, '#8FA3B5');
    }
    const cubes = [[-8, 11], [-4, 9], [0, 7], [4, 9], [8, 11], [-6, 13], [-2, 11], [2, 11], [6, 13], [-2, 5]];
    cubes.forEach(([dx, dy], i) => p.rect(cx + dx - 1, y + dy, 3, 3, i % 2 ? '#E3A65A' : '#D98E3E'));
    p.rect(cx - 10, y + 14, 20, 1, '#FFFFFF');
  }
}

function diamond(p: Painter, cx: number, cy: number, r: number, color: string) {
  for (let i = -r; i <= r; i++) {
    const half = r - Math.abs(i);
    p.rect(Math.round(cx) - half, Math.round(cy) + i, half * 2 + 1, 1, color);
  }
}
