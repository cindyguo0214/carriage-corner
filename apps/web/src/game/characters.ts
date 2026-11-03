// 乘客角色：64 × 64 cell，每個狀態 2～4 幀（docs/PRD.md §2.3）
import { CanvasSource, type Texture } from 'pixi.js';
import type { AvatarId, Mode, PaxState } from '@cc/shared';
import { atlasFrames, makeCanvas, mix, Painter } from './paint';
import { outfitFor, PALETTES, shade, type Outfit, type Palette } from './palette';

export const CELL = 64;
export type View = 'front' | 'back';

/** 每個狀態在 atlas 一列中的欄位 */
export const FRAMES: Record<PaxState, number[]> = {
  idle: [0, 1],
  coffee: [2, 3, 4],
  music: [5, 6],
  read: [7, 8, 9],
  sleep: [10, 11, 12, 13],
};
/** 每幀停留時間（ms）：慢到像在呼吸 */
export const FRAME_MS: Record<PaxState, number> = { idle: 700, coffee: 500, music: 400, read: 800, sleep: 600 };

const COLUMNS = 14;
const AVATARS: AvatarId[] = ['office', 'student', 'hoodie', 'headphone'];
const VIEWS: View[] = ['front', 'back'];
const STATE_OF_COLUMN: [PaxState, number][] = (Object.entries(FRAMES) as [PaxState, number[]][]).flatMap(
  ([state, cols]) => cols.map((_, frame) => [state, frame] as [PaxState, number]),
);

export type CharacterFrames = Record<AvatarId, Record<View, Texture[]>>;

export function buildCharacterAtlas(mode: Mode): CharacterFrames {
  const pal = PALETTES[mode];
  const { canvas, ctx } = makeCanvas(CELL * COLUMNS, CELL * AVATARS.length * VIEWS.length);
  const p = new Painter(ctx);
  AVATARS.forEach((avatar, a) =>
    VIEWS.forEach((view, v) => {
      const row = a * VIEWS.length + v;
      STATE_OF_COLUMN.forEach(([state, frame], col) =>
        drawCharacter(p, col * CELL, row * CELL, avatar, view, state, frame, pal, outfitFor(avatar, mode)),
      );
    }),
  );
  const source = new CanvasSource({ resource: canvas });
  const out = {} as CharacterFrames;
  AVATARS.forEach((avatar, a) => {
    out[avatar] = {
      front: atlasFrames(source, CELL, COLUMNS, a * 2),
      back: atlasFrames(source, CELL, COLUMNS, a * 2 + 1),
    };
  });
  return out;
}

interface Pose { bodyDy: number; headDy: number; headDx: number; eyes: 'open' | 'down' | 'closed' }

function poseOf(state: PaxState, frame: number): Pose {
  switch (state) {
    case 'idle': return { bodyDy: frame, headDy: frame, headDx: 0, eyes: 'open' };
    case 'coffee': return { bodyDy: 0, headDy: frame === 2 ? -1 : 0, headDx: 0, eyes: frame === 2 ? 'closed' : 'open' };
    case 'music': return { bodyDy: 0, headDy: frame, headDx: 0, eyes: 'closed' };
    case 'read': return { bodyDy: frame === 1 ? 1 : 0, headDy: 2, headDx: 0, eyes: 'down' };
    case 'sleep': return { bodyDy: frame === 1 || frame === 2 ? 1 : 0, headDy: [1, 2, 4, 2][frame], headDx: frame === 2 ? 1 : 0, eyes: 'closed' };
  }
}

/** 咖啡杯口位置（熱氣粒子的發射點），相對於 cell 左上角 */
export function cupAnchor(view: View, frame: number): { x: number; y: number } {
  if (view === 'back') return { x: 47, y: frame === 0 ? 34 : 18 };
  return [{ x: 40, y: 39 }, { x: 37, y: 27 }, { x: 35, y: 18 }][frame] ?? { x: 40, y: 39 };
}

function drawCharacter(
  p: Painter, ox: number, oy: number, avatar: AvatarId, view: View,
  state: PaxState, frame: number, pal: Palette, o: Outfit,
) {
  const R = (x: number, y: number, w: number, h: number, c: string) => p.rect(ox + x, oy + y, w, h, c);
  const pose = poseOf(state, frame);
  const ty = 26 + pose.bodyDy;
  const hx = 25 + pose.headDx;
  const hy = 8 + pose.headDy;
  const bottomLo = shade(o.bottom, 0.86);
  const phones = avatar === 'headphone' ? o.acc : mix(o.hair, pal.metal, 0.5);
  const cupSleeve = mix(pal.light, '#8C6A55', 0.45);

  if (view === 'front') {
    // 腿與鞋（坐姿正面）
    R(24, 52, 6, 7, bottomLo); R(34, 52, 6, 7, bottomLo);
    R(23, 59, 7, 3, pal.shoe); R(34, 59, 7, 3, pal.shoe);
    R(21, 46, 22, 7, o.bottom);
  }

  if (avatar === 'hoodie') R(23, 18 + pose.headDy, 18, 9, o.topLo); // 帽兜

  // 軀幹
  R(21, ty, 22, 46 - ty, o.top);
  R(40, ty + 1, 3, 45 - ty, o.topLo);
  p.clear(ox + 21, oy + ty, 1, 1);
  p.clear(ox + 42, oy + ty, 1, 1);

  // 頸
  R(30, Math.min(hy + 14, ty), 4, Math.max(1, ty - (hy + 14) + 1), pal.skinLo);

  if (view === 'front') {
    if (avatar === 'office') { R(30, ty, 4, 4, o.acc); R(31, ty + 4, 2, 1, o.acc); }
    if (avatar === 'student') { R(26, ty, 12, 1, o.acc); R(31, ty + 1, 2, 3, o.acc); }
    if (avatar === 'hoodie') { R(29, ty + 1, 1, 4, o.acc); R(34, ty + 1, 1, 4, o.acc); }
  } else if (avatar === 'hoodie') {
    R(23, ty - 1, 18, 6, o.topLo);
  }

  // 手臂與道具
  const armL = () => { R(18, ty + 2, 3, 15, o.topLo); R(19, ty + 17, 3, 3, pal.skin); };
  const armR = () => { R(43, ty + 2, 3, 15, o.topLo); R(42, ty + 17, 3, 3, pal.skin); };
  armL();
  if (view === 'front' && state === 'coffee') {
    if (frame === 0) {
      armR();
      R(38, 40, 5, 6, pal.paper); R(38, 42, 5, 2, cupSleeve);
    } else if (frame === 1) {
      R(43, ty + 2, 3, 8, o.topLo); R(37, ty + 8, 7, 3, o.topLo); R(36, ty + 7, 3, 3, pal.skin);
      R(35, ty + 1, 5, 6, pal.paper); R(35, ty + 3, 5, 2, cupSleeve);
    } else {
      R(43, ty + 2, 3, 7, o.topLo); R(38, ty + 3, 6, 3, o.topLo); R(36, ty + 1, 3, 3, pal.skin);
      R(33, hy + 10, 5, 6, pal.paper); R(33, hy + 12, 5, 2, cupSleeve);
    }
  } else if (view === 'front' && state === 'read') {
    R(43, ty + 2, 3, 9, o.topLo);
    R(22, ty + 10, 6, 3, o.topLo); R(36, ty + 10, 6, 3, o.topLo);
    const cover = mix('#B97A6F', pal.wallShade, 0.25);
    R(24, ty + 5, 16, 10, cover);
    R(25, ty + 5, 14, 9, pal.paper);
    R(31, ty + 5, 2, 9, shade(pal.paper, 0.86));
    for (let x = 26; x < 30; x += 2) { R(x, ty + 8, 1, 1, pal.wallShade); R(x + 8, ty + 8, 1, 1, pal.wallShade); R(x, ty + 11, 1, 1, pal.wallShade); R(x + 8, ty + 11, 1, 1, pal.wallShade); }
    if (frame === 2) R(33, ty + 2, 5, 4, pal.paper);
    R(23, ty + 11, 3, 3, pal.skin); R(38, ty + 11, 3, 3, pal.skin);
  } else if (view === 'back' && state === 'coffee' && frame > 0) {
    R(43, ty + 2, 3, 6, o.topLo); R(44, ty - 3, 3, 6, o.topLo);
    R(45, frame === 1 ? ty - 9 : hy + 6, 4, 6, pal.paper);
  } else {
    armR();
    if (view === 'back' && state === 'coffee') R(45, 34, 4, 6, pal.paper);
  }

  // 頭
  if (view === 'front') {
    if (avatar === 'student' || avatar === 'headphone') R(hx - 1, hy + 2, 16, avatar === 'student' ? 12 : 15, o.hair);
    R(hx + 1, hy + 2, 12, 12, pal.skin);
    R(hx, hy + 4, 14, 8, pal.skin);
    R(hx, hy, 14, 4, o.hair);
    R(hx - 1, hy + 2, 1, 5, o.hair); R(hx + 14, hy + 2, 1, 5, o.hair);
    R(hx + 1, hy + 4, avatar === 'office' ? 3 : 6, 1, o.hair);
    if (pose.eyes === 'open') { R(hx + 3, hy + 8, 1, 2, pal.eye); R(hx + 10, hy + 8, 1, 2, pal.eye); }
    else { R(hx + 3, hy + 9, 2, 1, pal.eye); R(hx + 9, hy + 9, 2, 1, pal.eye); }
    const blush = mix(pal.skin, '#C98BA0', 0.35);
    R(hx + 2, hy + 11, 2, 1, blush); R(hx + 10, hy + 11, 2, 1, blush);
  } else {
    R(hx, hy, 14, 14, o.hair);
    R(hx - 1, hy + 2, 16, 9, o.hair);
    R(hx - 1, hy + 7, 1, 2, pal.skin); R(hx + 14, hy + 7, 1, 2, pal.skin);
    if (avatar === 'student' || avatar === 'headphone') R(hx, hy + 12, 14, 3, o.hair);
  }

  if (state === 'music') {
    R(hx - 1, hy - 2, 16, 2, phones);
    R(hx - 2, hy + 5, 3, 5, phones); R(hx + 13, hy + 5, 3, 5, phones);
  } else if (avatar === 'headphone') {
    R(26, ty - 2, 3, 3, phones); R(35, ty - 2, 3, 3, phones); // 掛在脖子上
  }
}
