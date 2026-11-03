// 車窗景觀占位美術（docs/PRD.md §2.6）：地標只畫剪影，不標示任何真實名稱
import type { Texture } from 'pixi.js';
import type { LandmarkId } from '@cc/shared';
import { SCENE_H, W } from './layout';
import { mix, paint, rng, type Painter } from './paint';
import type { Palette } from './palette';

export type MidKind = 'skyline' | 'tower' | 'hotel' | 'river' | 'lake' | 'runway';
export type NearKind = 'urban' | 'rail';

export interface SceneryArt {
  sky: Texture;
  far: Texture;
  mid: Record<MidKind, Texture>;
  near: Record<NearKind, Texture>;
  tunnel: Texture;
  platformUnder: Texture;
  platformOpen: Texture;
  rain: Texture[];
}

const SH = SCENE_H;
export const TUNNEL_LIGHT_SPACING = 128;
export const PLATFORM_W = 1280;

export function midKindFor(landmarks: LandmarkId[]): MidKind {
  if (landmarks.includes('city_tower')) return 'tower';
  if (landmarks.includes('red_pillar_hotel')) return 'hotel';
  if (landmarks.includes('runway')) return 'runway';
  if (landmarks.includes('lake')) return 'lake';
  if (landmarks.includes('river')) return 'river';
  return 'skyline';
}

export function buildScenery(pal: Palette, night: boolean, accent: string): SceneryArt {
  return {
    sky: paint(W, SH, p => drawSky(p, pal, night)),
    far: paint(512, SH, p => drawHills(p, pal)),
    mid: {
      skyline: paint(768, SH, p => drawSkyline(p, pal, night, 11)),
      tower: paint(768, SH, p => { drawSkyline(p, pal, night, 23); drawTower(p, pal, night, 420); }),
      hotel: paint(768, SH, p => { drawSkyline(p, pal, night, 31, 0.5); drawHotel(p, pal, night, 300); }),
      river: paint(768, SH, p => drawWater(p, pal, night, 66, 41)),
      lake: paint(768, SH, p => drawWater(p, pal, night, 56, 53)),
      runway: paint(768, SH, p => drawRunway(p, pal, night)),
    },
    near: {
      urban: paint(256, SH, p => drawNear(p, pal, false)),
      rail: paint(256, SH, p => drawNear(p, pal, true)),
    },
    tunnel: paint(256, SH, p => drawTunnel(p, pal)),
    platformUnder: paint(PLATFORM_W, SH, p => drawPlatform(p, pal, accent, true)),
    platformOpen: paint(PLATFORM_W, SH, p => drawPlatform(p, pal, accent, false)),
    rain: [0, 1, 2].map(tilt => paint(4, 5, p => {
      for (let i = 0; i < 5; i++) p.px(3 - Math.round((i / 4) * tilt), i, pal.fog, 0.55);
    })),
  };
}

function drawSky(p: Painter, pal: Palette, night: boolean) {
  p.gradient(0, 0, W, SH, pal.skyTop, pal.skyBottom, 6);
  const r = rng(7);
  if (night) {
    for (let i = 0; i < 40; i++) p.px(Math.floor(r() * W), Math.floor(r() * 40), pal.glow, 0.3 + r() * 0.5);
    disc(p, 470, 22, 5, pal.glow, pal.skyTop);
  } else {
    disc(p, 470, 24, 8, '#F7EBD8', pal.skyBottom);
  }
}

function disc(p: Painter, cx: number, cy: number, r: number, color: string, halo: string) {
  for (let ring = 3; ring >= 1; ring--) {
    const rr = r + ring * 3;
    fillCircle(p, cx, cy, rr, mix(halo, color, 0.18 * (4 - ring)));
  }
  fillCircle(p, cx, cy, r, color);
}

function fillCircle(p: Painter, cx: number, cy: number, r: number, color: string) {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    p.rect(cx - half, cy + y, half * 2 + 1, 1, color);
  }
}

function drawHills(p: Painter, pal: Palette) {
  // 可左右無縫循環的遠山稜線（頻率需整除寬度）
  for (let x = 0; x < 512; x++) {
    const t = (x / 512) * Math.PI * 2;
    const h = 30 + Math.sin(t) * 10 + Math.sin(t * 3 + 1) * 6 + Math.sin(t * 7 + 2) * 2;
    p.rect(x, SH - h, 1, h, pal.far);
  }
}

function drawSkyline(p: Painter, pal: Palette, night: boolean, seed: number, density = 1) {
  const r = rng(seed);
  let x = 0;
  while (x < 768) {
    const w = 14 + Math.floor(r() * 26);
    const h = Math.floor((14 + r() * 46) * (0.6 + 0.4 * density));
    if (r() < 0.85 * density) {
      const top = SH - h;
      p.rect(x, top, w, h, r() < 0.5 ? pal.mid : pal.midLo);
      for (let wy = top + 4; wy < SH - 4; wy += 6) {
        for (let wx = x + 3; wx < x + w - 3; wx += 5) {
          if (night ? r() < 0.28 : r() < 0.5) p.rect(wx, wy, 2, 2, pal.windowLit, night ? 0.9 : 0.35);
        }
      }
    }
    x += w + Math.floor(r() * 6);
  }
}

/** 「城市之塔」：分節向上微微外擴的超高層剪影，只取輪廓印象 */
function drawTower(p: Painter, pal: Palette, night: boolean, cx: number) {
  const body = mix(pal.mid, pal.far, 0.35);
  p.rect(cx - 10, SH - 22, 20, 22, body);
  let y = SH - 22;
  for (let tier = 0; tier < 8; tier++) {
    const h = 7;
    for (let row = 0; row < h; row++) {
      const half = 6 + Math.floor((row / h) * 2);
      p.rect(cx - half, y - row, half * 2, 1, body);
    }
    if (night) p.rect(cx - 7, y - 1, 14, 1, pal.windowLit, 0.7);
    y -= h;
  }
  p.rect(cx - 3, y - 8, 6, 8, body);
  p.rect(cx - 1, y - 20, 2, 12, body);
  if (night) p.px(cx, y - 21, '#E86A6A', 0.9);
}

/** 「紅柱飯店」：山丘上的宮殿式屋頂剪影 */
function drawHotel(p: Painter, pal: Palette, night: boolean, x0: number) {
  for (let x = x0 - 80; x < x0 + 180; x++) {
    const t = (x - (x0 - 80)) / 260;
    const h = Math.round(Math.sin(t * Math.PI) * 26);
    p.rect(x, SH - h, 1, h, pal.near);
  }
  const base = SH - 26;
  const wall = mix(pal.paper, pal.mid, 0.55);
  p.rect(x0, base - 18, 100, 18, wall);
  const pillar = mix('#B97A6F', pal.mid, night ? 0.45 : 0.2);
  for (let x = x0 + 4; x < x0 + 98; x += 7) p.rect(x, base - 16, 2, 16, pillar);
  const roof = mix('#C9A36B', pal.mid, night ? 0.5 : 0.25);
  for (let tier = 0; tier < 3; tier++) {
    const w = 110 - tier * 26;
    const x = x0 + 50 - w / 2;
    const y = base - 18 - (tier + 1) * 7;
    p.rect(x, y + 3, w, 4, roof);
    p.rect(x - 2, y + 2, 3, 2, roof);
    p.rect(x + w - 1, y + 2, 3, 2, roof);
    if (tier < 2) p.rect(x + 8, y + 7, w - 16, 3, wall);
  }
  if (night) for (let x = x0 + 6; x < x0 + 96; x += 7) p.px(x + 2, base - 10, pal.windowLit, 0.9);
}

function drawWater(p: Painter, pal: Palette, night: boolean, waterTop: number, seed: number) {
  drawSkyline(p, pal, night, seed, 0.35);
  p.rect(0, waterTop, 768, SH - waterTop, pal.water);
  const r = rng(seed + 5);
  for (let i = 0; i < 90; i++) {
    const y = waterTop + 2 + Math.floor(r() * (SH - waterTop - 2));
    p.rect(Math.floor(r() * 768), y, 3 + Math.floor(r() * 8), 1, night ? pal.windowLit : pal.waterHi, night ? 0.35 : 0.8);
  }
}

function drawRunway(p: Painter, pal: Palette, night: boolean) {
  drawSkyline(p, pal, night, 61, 0.25);
  p.rect(0, 76, 768, SH - 76, pal.midLo);
  p.rect(0, 82, 768, 3, pal.near);
  for (let x = 0; x < 768; x += 12) p.rect(x, 80, 2, 1, night ? pal.windowLit : pal.metalHi, night ? 1 : 0.6);
}

function drawNear(p: Painter, pal: Palette, railing: boolean) {
  // 架空線桿：每 128 px 一支（寬度 256 可無縫循環）
  for (const x of [40, 168]) {
    p.rect(x, 0, 3, SH, pal.near);
    p.rect(x - 10, 10, 24, 2, pal.near);
  }
  p.rect(0, 13, 256, 1, pal.near, 0.6);
  if (railing) {
    p.rect(0, 80, 256, 2, pal.near);
    for (let x = 0; x < 256; x += 8) p.rect(x, 82, 1, 14, pal.near);
  } else {
    p.rect(0, 78, 256, SH - 78, pal.near);
    for (let x = 0; x < 256; x += 16) p.rect(x, 78, 1, SH - 78, mix(pal.near, pal.far, 0.3));
  }
}

function drawTunnel(p: Painter, pal: Palette) {
  p.rect(0, 0, 256, SH, pal.tunnel);
  for (let x = 0; x < 256; x += 32) p.rect(x, 0, 3, SH, pal.tunnelLo);
  p.rect(0, 30, 256, 2, pal.tunnelLo);
  p.rect(0, 36, 256, 1, pal.tunnelLo);
  p.rect(0, 76, 256, 1, pal.tunnelLo);
  // 隧道燈：每 TUNNEL_LIGHT_SPACING px 一盞，帶 3 階像素光暈
  for (let x = 60; x < 256; x += TUNNEL_LIGHT_SPACING) {
    for (let ring = 3; ring >= 1; ring--) {
      p.rect(x - ring * 3, 20 - ring * 2, 8 + ring * 6, 3 + ring * 4, pal.tunnelLight, 0.07 * (4 - ring));
    }
    p.rect(x, 20, 8, 3, pal.tunnelLight);
  }
}

function drawPlatform(p: Painter, pal: Palette, accent: string, underground: boolean) {
  const r = rng(underground ? 3 : 9);
  if (underground) {
    p.rect(0, 0, PLATFORM_W, SH, pal.platformWall);
    for (let y = 0; y < SH; y += 8) p.rect(0, y, PLATFORM_W, 1, pal.platformTile);
    for (let x = 0; x < PLATFORM_W; x += 8) p.rect(x, 0, 1, SH, pal.platformTile);
    p.rect(0, 0, PLATFORM_W, 10, pal.tunnel);
  } else {
    p.rect(0, 0, PLATFORM_W, 9, pal.metalLo);
    p.rect(0, 9, PLATFORM_W, 2, pal.metal);
  }
  for (let x = 80; x < PLATFORM_W; x += 160) {
    p.rect(x, underground ? 10 : 11, underground ? 16 : 4, SH, underground ? pal.wallShade : pal.metalLo);
    // 原創站名方標：路線色圓角方塊＋白點，不仿官方站碼圓標
    const bx = x + (underground ? 2 : -4);
    p.round(bx, 30, 12, 12, accent);
    p.rect(bx + 3, 35, 6, 2, pal.glow);
  }
  // 虛構品牌廣告：純色塊構圖，不含任何文字或真實品牌
  const adColors = ['#C98BA0', '#7FA9A3', '#D4A373', '#8FA3B5'];
  for (let x = 120; x < PLATFORM_W; x += 160) {
    if (!underground && r() < 0.5) continue;
    const c = adColors[Math.floor(r() * adColors.length)];
    p.rect(x, 22, 44, 30, pal.metalLo);
    p.rect(x + 2, 24, 40, 26, mix(c, pal.platformWall, 0.35));
    p.rect(x + 8, 30, 12, 12, mix(c, '#ffffff', 0.25));
    p.rect(x + 24, 32, 12, 2, pal.glow);
    p.rect(x + 24, 36, 9, 2, pal.glow);
  }
  if (underground) {
    p.rect(0, 84, PLATFORM_W, 3, pal.warning);
    p.rect(0, 87, PLATFORM_W, SH - 87, pal.platformTile);
  } else {
    p.rect(0, 78, PLATFORM_W, 2, pal.metal);
    for (let x = 0; x < PLATFORM_W; x += 6) p.rect(x, 80, 1, 10, pal.metalLo);
    p.rect(0, 90, PLATFORM_W, SH - 90, pal.platformTile);
    p.rect(0, 88, PLATFORM_W, 2, pal.warning);
  }
}
