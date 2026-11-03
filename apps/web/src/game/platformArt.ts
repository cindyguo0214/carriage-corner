// 月台占位美術（docs/PRD.md §2.5、§3）：站名、月台門、列車外觀、長椅都是原創設計，不臨摹任何真實車站
import type { Texture } from 'pixi.js';
import type { LineDef } from '@cc/shared';
import { DOORS, H, SEAT_W, SEAT_X0, W } from './layout';
import { mix, paint, pixelText, rng, type Painter } from './paint';
import type { Palette } from './palette';

// ── 版面（640 × 360）──
export const CEIL_H = 28;
/** 列車車頂與車底 */
export const TRAIN_TOP = 66;
export const TRAIN_H = 132;
export const CAR_W = W;
export const CAR_GAP = 12;
/** 月台門（地下站全高、高架站半高）與月台邊緣 */
export const PSD_TOP = 44;
export const PSD_BOTTOM = 206;
export const GATE_TOP = 150;
export const FLOOR_TOP = 218;
/** 列車車門在車身上的範圍（與車廂內的車門對齊） */
export const TRAIN_DOOR_TOP = 14;
export const TRAIN_DOOR_H = 110;
/** 長椅：背對鏡頭、面向軌道 */
export const BENCHES = [{ x: 168 }, { x: 332 }] as const;
export const BENCH_W = 140;
export const BENCH_TOP = 300;
export const BENCH_H = 38;
export const BENCH_SEAT_DX = [24, 70, 116] as const;

export interface PlatformArt {
  ceiling: Texture;
  back: Texture;
  car: Texture;
  /** 車門左右兩片門扇（外側看） */
  carLeaves: [Texture, Texture];
  psd: Texture;
  /** 月台門左右兩片（全高玻璃或半高閘門） */
  psdLeaves: [Texture, Texture];
  floor: Texture;
  bench: Texture;
}

export function buildPlatformArt(pal: Palette, night: boolean, line: LineDef, station: number, underground: boolean): PlatformArt {
  const s = line.stations[station];
  const leafW = DOORS[0].w / 2 - 2;
  const psdLeafH = underground ? PSD_BOTTOM - PSD_TOP - 16 : PSD_BOTTOM - GATE_TOP;
  return {
    ceiling: paint(W, CEIL_H, p => drawCeiling(p, pal, line, s.zh, s.code)),
    back: paint(W, PSD_BOTTOM - CEIL_H, p => drawBack(p, pal, night, line, s.zh, s.en, underground)),
    car: paint(CAR_W, TRAIN_H, p => drawCar(p, pal, night, line)),
    carLeaves: [0, 1].map(side => paint(leafW, TRAIN_DOOR_H, p => drawCarLeaf(p, pal, night, side === 1))) as [Texture, Texture],
    psd: paint(W, PSD_BOTTOM - CEIL_H, p => drawPsd(p, pal, line, underground)),
    psdLeaves: [0, 1].map(side => paint(leafW, psdLeafH, p => drawPsdLeaf(p, pal, side === 1, underground))) as [Texture, Texture],
    floor: paint(W, H - PSD_BOTTOM, p => drawFloor(p, pal)),
    bench: paint(BENCH_W, BENCH_H, p => drawBench(p, pal, line)),
  };
}

const trainBody = (pal: Palette, night: boolean) => (night ? mix(pal.metal, pal.wall, 0.3) : mix(pal.metalHi, pal.wallHi, 0.4));

function drawCeiling(p: Painter, pal: Palette, line: LineDef, zh: string, code: string) {
  p.rect(0, 0, W, CEIL_H, pal.ceiling);
  for (let x = 16; x < W; x += 96) p.rect(x, 20, 64, 3, pal.ceilingLight);
  p.rect(0, CEIL_H - 1, W, 1, pal.wallShade);
  // 吊掛站名牌：深色底、路線色標、站碼
  const sw = 168;
  const sx = (W - sw) / 2;
  p.rect(sx + 30, 0, 1, 4, pal.metalLo); p.rect(sx + sw - 31, 0, 1, 4, pal.metalLo);
  p.round(sx, 4, sw, 21, pal.led);
  p.rect(sx + 4, 8, 12, 13, line.color);
  pixelText(p, line.id, sx + 10, 10, 7, '#ffffff', { align: 'center', bold: true });
  pixelText(p, zh, sx + sw / 2 + 4, 6, 13, pal.ledOn, { align: 'center', bold: true });
  pixelText(p, code, sx + sw - 8, 14, 7, pal.ledDim === '#3E3B44' ? '#8A8590' : '#A8A3AC', { align: 'center' });
}

function drawBack(p: Painter, pal: Palette, night: boolean, line: LineDef, zh: string, en: string, underground: boolean) {
  const h = PSD_BOTTOM - CEIL_H;
  const r = rng(zh.length * 97 + en.length);
  if (underground) {
    p.rect(0, 0, W, h, pal.platformWall);
    for (let y = 4; y < h; y += 10) p.rect(0, y, W, 1, pal.platformTile);
    for (let x = 0; x < W; x += 20) p.rect(x, 0, 1, h, pal.platformTile);
    p.rect(0, 30, W, 6, line.color);
    p.rect(0, 36, W, 1, mix(line.color, '#000000', 0.25));
    // 大站名板
    p.round(212, 56, 216, 52, pal.paper);
    p.rect(216, 60, 6, 44, line.color);
    pixelText(p, zh, 326, 60, 24, pal.eye, { align: 'center', bold: true });
    pixelText(p, en, 326, 90, 9, mix(pal.eye, pal.paper, 0.35), { align: 'center' });
    // 留白的廣告框：不放任何真實品牌
    for (const x of [40, 488]) {
      p.round(x, 52, 112, 64, pal.metalLo);
      p.rect(x + 3, 55, 106, 58, mix(night ? '#C98BA0' : '#E6C9A8', pal.platformWall, 0.45));
      p.rect(x + 12, 68, 40 + Math.floor(r() * 40), 4, pal.paper);
      p.rect(x + 12, 78, 30 + Math.floor(r() * 30), 3, pal.paper);
    }
  } else {
    p.gradient(0, 0, W, 130, pal.skyTop, pal.skyBottom, 6);
    if (night) for (let i = 0; i < 30; i++) p.px(Math.floor(r() * W), Math.floor(r() * 50), pal.glow, 0.5);
    // 遠方天際線
    let x = 0;
    while (x < W) {
      const bw = 18 + Math.floor(r() * 30);
      const bh = 20 + Math.floor(r() * 50);
      p.rect(x, 130 - bh, bw, bh, pal.far);
      if (night) for (let k = 0; k < 4; k++) p.px(x + 3 + Math.floor(r() * (bw - 6)), 130 - bh + 4 + Math.floor(r() * (bh - 8)), pal.windowLit, 0.8);
      x += bw + Math.floor(r() * 6);
    }
    p.rect(0, 120, W, 10, pal.mid);
    // 雨棚邊緣
    p.rect(0, 0, W, 8, pal.ceiling);
    p.rect(0, 8, W, 2, pal.metalLo);
    // 對向的護欄
    p.rect(0, 136, W, 2, pal.metal);
    for (let fx = 0; fx < W; fx += 16) p.rect(fx, 136, 1, 14, pal.metal);
  }
  // 軌道
  p.rect(0, h - 22, W, 22, mix(pal.tunnelLo, pal.floorShade, 0.3));
  p.rect(0, h - 14, W, 2, pal.metal);
  p.rect(0, h - 6, W, 2, pal.metal);
  for (let tx = 0; tx < W; tx += 12) p.rect(tx, h - 12, 6, 6, pal.tunnel);
}

function drawCar(p: Painter, pal: Palette, night: boolean, line: LineDef) {
  const body = trainBody(pal, night);
  const bodyLo = mix(body, '#000000', 0.15);
  const inside = night ? mix(pal.ceilingLight, pal.wall, 0.5) : mix(pal.wallHi, pal.ceilingLight, 0.5);
  const insideLo = mix(inside, pal.seat[line.seatColor].base, 0.35);
  p.round(0, 0, CAR_W, TRAIN_H - 8, body);
  p.rect(2, 0, CAR_W - 4, 6, mix(body, '#FFFFFF', 0.2));
  p.rect(0, 8, CAR_W, 1, bodyLo);
  // 車窗：看得到車廂裡的燈光與幾個坐著的人影
  const r = rng(line.id.charCodeAt(0) * 13);
  for (let i = 0; i < 6; i++) {
    const x = SEAT_X0 + i * SEAT_W + 4;
    p.round(x - 2, 24, 60, 52, bodyLo);
    p.rect(x, 26, 56, 48, inside);
    p.rect(x, 60, 56, 14, insideLo);
    if (r() < 0.6) {
      const hx = x + 10 + Math.floor(r() * 30);
      p.rect(hx, 46, 12, 12, mix(pal.eye, inside, 0.45));
      p.rect(hx - 4, 56, 20, 18, mix(pal.eye, inside, 0.55));
    }
    p.rect(x, 26, 56, 2, mix(inside, '#FFFFFF', 0.3));
  }
  // 路線色帶
  p.rect(0, 88, CAR_W, 6, line.color);
  p.rect(0, 94, CAR_W, 1, mix(line.color, '#000000', 0.3));
  // 車門洞：門扇滑開後看到車廂裡的地板
  for (const d of DOORS) {
    p.rect(d.x, TRAIN_DOOR_TOP - 2, d.w, TRAIN_DOOR_H + 2, bodyLo);
    p.rect(d.x + 2, TRAIN_DOOR_TOP, d.w - 4, TRAIN_DOOR_H, inside);
    p.rect(d.x + 2, TRAIN_DOOR_TOP + TRAIN_DOOR_H - 22, d.w - 4, 22, mix(pal.floor, inside, 0.3));
    p.rect(d.x + 4, 2, d.w - 8, 6, pal.led);
    p.rect(d.x + 8, 4, d.w - 16, 2, mix(pal.ledOn, pal.led, 0.4));
  }
  // 車底
  p.rect(0, TRAIN_H - 8, CAR_W, 8, pal.tunnelLo);
  for (const x of [80, CAR_W - 140]) p.rect(x, TRAIN_H - 8, 60, 6, pal.metalLo);
}

function drawCarLeaf(p: Painter, pal: Palette, night: boolean, right: boolean) {
  const w = DOORS[0].w / 2 - 2;
  const body = trainBody(pal, night);
  p.rect(0, 0, w, TRAIN_DOOR_H, mix(body, '#000000', 0.06));
  p.rect(right ? 0 : w - 1, 0, 1, TRAIN_DOOR_H, mix(body, '#000000', 0.3));
  const wx = right ? 6 : 7;
  p.round(wx - 1, 12, 24, 46, mix(body, '#000000', 0.2));
  p.rect(wx, 13, 22, 44, night ? mix(pal.ceilingLight, pal.wall, 0.55) : mix(pal.wallHi, pal.skyTop, 0.4));
  p.rect(0, 74, w, 6, mix(pal.metal, body, 0.5));
}

function drawPsd(p: Painter, pal: Palette, line: LineDef, underground: boolean) {
  const off = CEIL_H;
  const isDoor = (x: number) => DOORS.some(d => x >= d.x && x < d.x + d.w);
  if (underground) {
    // 上方橫樑與門上的小燈箱
    p.rect(0, PSD_TOP - off, W, 14, pal.metalLo);
    p.rect(0, PSD_TOP - off + 14, W, 2, pal.metal);
    for (const d of DOORS) {
      p.rect(d.x + 10, PSD_TOP - off + 3, d.w - 20, 8, pal.led);
      p.rect(d.x + 14, PSD_TOP - off + 6, 4, 2, line.color);
      p.rect(d.x + 22, PSD_TOP - off + 6, d.w - 36, 2, pal.ledOn);
    }
    // 固定的玻璃面板：淡淡的霧面＋斜向反光
    for (let x = 0; x < W; x += 1) {
      if (isDoor(x)) continue;
      p.rect(x, PSD_TOP - off + 16, 1, PSD_BOTTOM - PSD_TOP - 16, pal.fog, 0.16);
    }
    for (let x = 0; x < W; x += 64) {
      if (isDoor(x + 20)) continue;
      for (let i = 0; i < 30; i++) p.px(x + 20 + i, PSD_TOP - off + 30 + i * 2, pal.fog, 0.25);
    }
    for (let x = 0; x <= W; x += 64) p.rect(x - 1, PSD_TOP - off + 16, 3, PSD_BOTTOM - PSD_TOP - 16, pal.metal);
  } else {
    // 高架站：半高的月台閘門
    for (let x = 0; x < W; x++) {
      if (isDoor(x)) continue;
      p.rect(x, GATE_TOP - off, 1, PSD_BOTTOM - GATE_TOP, pal.fog, 0.22);
    }
    p.rect(0, GATE_TOP - off, W, 3, pal.metal);
    for (let x = 0; x <= W; x += 64) p.rect(x - 1, GATE_TOP - off, 3, PSD_BOTTOM - GATE_TOP, pal.metal);
  }
  // 門洞兩側的門柱
  for (const d of DOORS) {
    const top = (underground ? PSD_TOP + 16 : GATE_TOP) - off;
    p.rect(d.x - 3, top, 4, PSD_BOTTOM - off - top, pal.metalLo);
    p.rect(d.x + d.w - 1, top, 4, PSD_BOTTOM - off - top, pal.metalLo);
  }
}

function drawPsdLeaf(p: Painter, pal: Palette, right: boolean, underground: boolean) {
  const w = DOORS[0].w / 2 - 2;
  const h = underground ? PSD_BOTTOM - PSD_TOP - 16 : PSD_BOTTOM - GATE_TOP;
  p.rect(0, 0, w, h, pal.fog, 0.2);
  p.rect(0, 0, w, 2, pal.metal);
  p.rect(0, h - 3, w, 3, pal.metal);
  p.rect(right ? w - 2 : 0, 0, 2, h, pal.metal);
  p.rect(right ? 0 : w - 1, 0, 1, h, pal.metalLo);
  for (let i = 0; i < Math.min(14, h / 3); i++) p.px((right ? 6 : 10) + i, 8 + i * 2, pal.fog, 0.4);
  // 門上的路線方向貼紙（原創：只有一個箭頭）
  p.rect(right ? 4 : w - 14, Math.round(h * 0.55), 10, 3, pal.warning);
}

function drawFloor(p: Painter, pal: Palette) {
  const h = H - PSD_BOTTOM;
  p.rect(0, 0, W, 6, pal.metal);
  p.rect(0, 6, W, 6, pal.warning);
  for (let x = 1; x < W; x += 4) p.px(x, 8, mix(pal.warning, '#000000', 0.15));
  p.rect(0, 12, W, h - 12, pal.platformTile);
  for (let y = 12; y < h; y += 18) p.rect(0, y, W, 1, mix(pal.platformTile, pal.platformWall, 0.5));
  for (let x = 0; x < W; x += 36) p.rect(x, 12, 1, h - 12, mix(pal.platformTile, pal.platformWall, 0.5));
  // 候車線：門的兩側排隊、中間留給下車的人
  for (const d of DOORS) {
    const cx = d.x + d.w / 2;
    for (const ax of [cx - 26, cx + 22]) arrow(p, ax, 18, -1, pal.ledOn);
    arrow(p, cx - 2, 26, 1, mix(pal.ledOn, pal.platformTile, 0.4));
  }
}

function arrow(p: Painter, x: number, y: number, dir: 1 | -1, color: string) {
  for (let i = 0; i < 3; i++) p.rect(x - i, y + (dir === -1 ? i : 2 - i), 4 + i * 2 - 2, 1, color);
  p.rect(x, y + (dir === -1 ? 3 : -3), 2, 4, color);
}

function drawBench(p: Painter, pal: Palette, line: LineDef) {
  const tone = pal.seat[line.seatColor];
  // 從背後看：椅背、橫條、四隻腳
  p.round(0, 0, BENCH_W, 20, tone.base);
  p.rect(2, 0, BENCH_W - 4, 2, tone.hi);
  for (const dx of [46, 92]) p.rect(dx, 2, 2, 18, tone.lo);
  p.rect(0, 20, BENCH_W, 4, pal.metalLo);
  for (const lx of [8, BENCH_W - 12]) p.rect(lx, 24, 4, BENCH_H - 24, pal.metalLo);
}
