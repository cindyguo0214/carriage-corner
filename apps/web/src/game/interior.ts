// 車廂內裝占位美術：牆面（車窗挖空）、天花板、車門、地板、座椅、立柱、吊環（docs/PRD.md §2.5、§3.5）
import type { Texture } from 'pixi.js';
import { PRIORITY_SEATS, type SeatId } from '@cc/shared';
import {
  B_PANEL_Y, CEIL_H, DOORS, FLOOR_Y, H, POLES, SEAT_W, SEAT_X0, STRAP_Y, W, windowRect,
} from './layout';
import { paint, type Painter } from './paint';
import type { Palette } from './palette';

export interface InteriorArt {
  back: Texture;
  front: Texture;
  /** 吊環：索引 0..4 對應傾斜 -2..+2 px */
  straps: Texture[];
  /** 車門左右兩片門扇（門窗挖空） */
  doorLeaves: [Texture, Texture];
}

/** 門洞（門扇滑開後露出的範圍） */
export const DOOR_TOP = 42;
export const doorHole = (d: { x: number; w: number }) => ({ x: d.x + 2, y: DOOR_TOP, w: d.w - 4, h: FLOOR_Y - DOOR_TOP });
/** 兩端貫通道的寬度 */
export const GANGWAY_W = 16;

export function buildInterior(pal: Palette, seatColor: 'blue' | 'yellow'): InteriorArt {
  return {
    back: paint(W, H, p => drawBack(p, pal, seatColor)),
    front: paint(W, H - B_PANEL_Y, p => drawFront(p, pal, seatColor)),
    straps: [-2, -1, 0, 1, 2].map(lean => paint(9, 40, p => drawStrap(p, pal, lean))),
    doorLeaves: [0, 1].map(side => paint(DOORS[0].w / 2 - 2, FLOOR_Y - DOOR_TOP, p => drawDoorLeaf(p, pal, side === 1))) as [Texture, Texture],
  };
}

/** 一片門扇：內側邊緣較深，門窗挖空讓窗外透進來 */
function drawDoorLeaf(p: Painter, pal: Palette, right: boolean) {
  const w = DOORS[0].w / 2 - 2;
  const h = FLOOR_Y - DOOR_TOP;
  p.rect(0, 0, w, h, pal.door);
  p.rect(right ? 0 : w - 1, 0, 1, h, pal.doorLo);
  p.rect(0, h - 4, w, 4, pal.doorLo);
  const wx = right ? 6 : 7;
  p.round(wx - 1, 17, 24, 52, pal.doorLo);
  p.clear(wx, 18, 22, 50);
}

function seatTone(pal: Palette, seatColor: 'blue' | 'yellow', seat: SeatId) {
  return PRIORITY_SEATS.has(seat) ? pal.seat.priority : pal.seat[seatColor];
}

function drawBack(p: Painter, pal: Palette, seatColor: 'blue' | 'yellow') {
  // 牆面
  p.rect(0, 0, W, FLOOR_Y, pal.wall);
  p.rect(0, 136, W, FLOOR_Y - 136, pal.wallShade);

  // 天花板：燈帶與通風口
  p.rect(0, 0, W, CEIL_H, pal.ceiling);
  p.rect(0, 25, W, 4, pal.ceilingLight);
  p.rect(0, 29, W, 1, pal.wallHi);
  p.rect(0, CEIL_H, W, 1, pal.wallShade);
  for (let x = 140; x < 500; x += 24) p.rect(x, 12, 12, 2, pal.wallShade);

  // 扶手橫桿
  p.rect(104, STRAP_Y, 432, 2, pal.metal);
  p.rect(104, STRAP_Y, 432, 1, pal.metalHi);

  // 車窗：外框後挖空，讓後方景觀透出
  for (let i = 0; i < 6; i++) {
    const r = windowRect(i);
    p.round(r.x - 2, r.y - 2, r.w + 4, r.h + 4, pal.metalLo);
    p.rect(r.x - 1, r.y - 1, r.w + 2, 1, pal.metalHi);
    p.clear(r.x, r.y, r.w, r.h);
    p.rect(r.x, r.y, 1, 1, pal.metalLo); p.rect(r.x + r.w - 1, r.y, 1, 1, pal.metalLo);
    p.rect(r.x, r.y + r.h - 1, 1, 1, pal.metalLo); p.rect(r.x + r.w - 1, r.y + r.h - 1, 1, 1, pal.metalLo);
    p.rect(r.x - 2, r.y + r.h + 2, r.w + 4, 2, pal.metal);
  }

  // 車門框（門扇是獨立的圖層，到站時滑開）與門上方 LED 路線圖框
  for (const d of DOORS) {
    p.rect(d.x, 40, d.w, 2, pal.metalLo);
    p.rect(d.x, 40, 2, FLOOR_Y - 40, pal.doorLo); p.rect(d.x + d.w - 2, 40, 2, FLOOR_Y - 40, pal.doorLo);
    const hole = doorHole(d);
    p.clear(hole.x, hole.y, hole.w, hole.h);
    p.rect(d.x + 4, 6, d.w - 8, 20, pal.metalLo);
    p.rect(d.x + 5, 7, d.w - 10, 18, pal.led);
    p.rect(d.x, FLOOR_Y, d.w, 3, pal.metal);
    p.rect(d.x, FLOOR_Y + 3, d.w, 2, pal.warning);
  }

  // 車廂兩端的貫通道：門框＋通往隔壁車廂的暗處（箭頭由車廂場景畫，會動）
  for (const x of [0, W - GANGWAY_W]) {
    p.rect(x, 40, GANGWAY_W, FLOOR_Y - 40, pal.metalLo);
    p.rect(x + 2, 44, GANGWAY_W - 4, FLOOR_Y - 44, pal.led);
    p.rect(x + 3, 46, GANGWAY_W - 6, FLOOR_Y - 48, pal.wallShade);
  }

  // 地板
  p.rect(0, FLOOR_Y, W, H - FLOOR_Y, pal.floor);
  for (let y = FLOOR_Y + 20; y < H; y += 26) p.rect(0, y, W, 1, pal.floorShade);
  p.rect(SEAT_X0, FLOOR_Y, SEAT_W * 6, 4, pal.floorShade);

  // A 排長椅（正面）
  for (let n = 1; n <= 6; n++) {
    const seat = `${n}A` as SeatId;
    const tone = seatTone(pal, seatColor, seat);
    const x = SEAT_X0 + (n - 1) * SEAT_W;
    p.round(x + 3, 134, SEAT_W - 6, 26, tone.base);
    p.rect(x + 4, 134, SEAT_W - 8, 1, tone.hi);
    p.rect(x + 3, 154, SEAT_W - 6, 6, tone.lo);
    p.rect(x + 1, 158, SEAT_W - 2, 7, tone.hi);
    p.rect(x + 1, 165, SEAT_W - 2, 10, tone.lo);
    if (PRIORITY_SEATS.has(seat)) drawPriorityIcon(p, x + 8, 139, tone.hi);
  }
  // 長椅兩端的玻璃隔板
  for (const x of [SEAT_X0 - 5, SEAT_X0 + SEAT_W * 6 + 1]) {
    p.rect(x, 112, 4, 64, pal.metalLo);
    p.rect(x + 1, 114, 2, 60, pal.wallHi);
  }

  // 中央立柱
  for (const x of POLES) {
    p.rect(x, CEIL_H, 3, H - CEIL_H, pal.metal);
    p.rect(x, CEIL_H, 1, H - CEIL_H, pal.metalHi);
    p.rect(x + 2, CEIL_H, 1, H - CEIL_H, pal.metalLo);
  }
}

/** 原創博愛座像素圖示（不臨摹官方貼紙） */
function drawPriorityIcon(p: Painter, x: number, y: number, color: string) {
  p.rect(x + 2, y, 2, 2, color);
  p.rect(x + 1, y + 3, 4, 4, color);
  p.rect(x + 1, y + 7, 1, 3, color);
  p.rect(x + 4, y + 7, 1, 3, color);
  p.rect(x + 6, y + 3, 1, 7, color);
}

function drawFront(p: Painter, pal: Palette, seatColor: 'blue' | 'yellow') {
  // B 排長椅的椅背（從後方看），覆蓋 B 排乘客的下半身
  for (let n = 1; n <= 6; n++) {
    const seat = `${n}B` as SeatId;
    const tone = seatTone(pal, seatColor, seat);
    const x = SEAT_X0 + (n - 1) * SEAT_W;
    p.round(x + 2, 0, SEAT_W - 4, H - B_PANEL_Y, tone.lo);
    p.rect(x + 3, 0, SEAT_W - 6, 2, tone.base);
    p.rect(x + 3, 2, SEAT_W - 6, 1, tone.hi);
  }
  p.rect(SEAT_X0 - 6, 8, 6, H - B_PANEL_Y - 8, pal.metalLo);
  p.rect(SEAT_X0 + SEAT_W * 6, 8, 6, H - B_PANEL_Y - 8, pal.metalLo);
}

function drawStrap(p: Painter, pal: Palette, lean: number) {
  const len = 28;
  for (let i = 0; i < len; i++) {
    const dx = Math.round((i / len) * lean);
    p.rect(3 + dx, i, 2, 1, pal.metalLo);
  }
  const rx = 1 + lean;
  p.rect(rx + 1, len, 5, 1, pal.metal);
  p.rect(rx, len + 1, 1, 5, pal.metal);
  p.rect(rx + 6, len + 1, 1, 5, pal.metal);
  p.rect(rx + 1, len + 6, 5, 1, pal.metal);
  p.rect(rx + 1, len + 1, 5, 1, pal.metalHi);
}
