// 乘客角色：64 × 64 cell，每個動作 2～4 幀（docs/PRD.md §2.3）。4 種穿搭＋長者、家長（第 20 章）× 男／女 × 正面／背面。
import { CanvasSource, type Texture } from 'pixi.js';
import { AVATARS, SPECIAL_KINDS, type AvatarId, type Gender, type Mode, type PaxState } from '@cc/shared';
import { atlasFrames, makeCanvas, mix, Painter } from './paint';
import { outfitFor, PALETTES, shade, type Outfit, type Palette } from './palette';

export const CELL = 64;
export type View = 'front' | 'back';
/** 坐著的狀態之外，還會站著、走路、在走道上拉吊環 */
export type Anim = PaxState | 'stand' | 'walk' | 'hang';

/** 每個動作在 atlas 一列中的欄位 */
export const FRAMES: Record<Anim, number[]> = {
  idle: [0, 1],
  music: [2, 3],
  read: [4, 5, 6],
  sleep: [7, 8, 9, 10],
  stand: [11, 12],
  walk: [13, 14],
  hang: [15, 16],
};
/** 每幀停留時間（ms）：慢到像在呼吸 */
export const FRAME_MS: Record<Anim, number> = { idle: 700, music: 400, read: 800, sleep: 600, stand: 800, walk: 180, hang: 900 };
/** 站姿比坐姿高的像素數：名字標籤用 */
export const STAND_RISE = 6;

const COLUMNS = 17;
const ALL_AVATARS: AvatarId[] = [...AVATARS, ...SPECIAL_KINDS];
const GENDERS: Gender[] = ['m', 'f'];
const VIEWS: View[] = ['front', 'back'];
const ANIM_OF_COLUMN: [Anim, number][] = (Object.entries(FRAMES) as [Anim, number[]][]).flatMap(
  ([anim, cols]) => cols.map((_, frame) => [anim, frame] as [Anim, number]),
);

export type CharacterFrames = Record<AvatarId, Record<Gender, Record<View, Texture[]>>>;

export function buildCharacterAtlas(mode: Mode): CharacterFrames {
  const pal = PALETTES[mode];
  const rows = ALL_AVATARS.length * GENDERS.length * VIEWS.length;
  const { canvas, ctx } = makeCanvas(CELL * COLUMNS, CELL * rows);
  const p = new Painter(ctx);
  const rowOf = (a: number, g: number, v: number) => (a * GENDERS.length + g) * VIEWS.length + v;
  ALL_AVATARS.forEach((avatar, a) =>
    GENDERS.forEach((gender, g) =>
      VIEWS.forEach((view, v) => {
        const look: Look = { avatar, gender, view, o: outfitFor(avatar, gender, mode) };
        ANIM_OF_COLUMN.forEach(([anim, frame], col) =>
          drawCharacter(p, col * CELL, rowOf(a, g, v) * CELL, look, anim, frame, pal),
        );
      }),
    ),
  );
  const source = new CanvasSource({ resource: canvas });
  const out = {} as CharacterFrames;
  ALL_AVATARS.forEach((avatar, a) => {
    out[avatar] = { m: {}, f: {} } as Record<Gender, Record<View, Texture[]>>;
    GENDERS.forEach((gender, g) => {
      out[avatar][gender] = {
        front: atlasFrames(source, CELL, COLUMNS, rowOf(a, g, 0)),
        back: atlasFrames(source, CELL, COLUMNS, rowOf(a, g, 1)),
      };
    });
  });
  return out;
}

/** 閘門的角色預覽：在 64×64 的畫布上畫一格正面站姿（frame 0／1 輪流就是呼吸） */
export function paintPreview(ctx: CanvasRenderingContext2D, avatar: AvatarId, gender: Gender, mode: Mode, frame: number) {
  ctx.clearRect(0, 0, CELL, CELL);
  drawCharacter(new Painter(ctx), 0, 0, { avatar, gender, view: 'front', o: outfitFor(avatar, gender, mode) }, 'stand', frame, PALETTES[mode]);
}

interface Look { avatar: AvatarId; gender: Gender; view: View; o: Outfit }
interface Pose { bodyDy: number; headDy: number; headDx: number; eyes: 'open' | 'down' | 'closed' }

function poseOf(anim: Anim, frame: number): Pose {
  switch (anim) {
    case 'idle': return { bodyDy: frame, headDy: frame, headDx: 0, eyes: 'open' };
    case 'music': return { bodyDy: 0, headDy: frame, headDx: 0, eyes: 'closed' };
    case 'read': return { bodyDy: frame === 1 ? 1 : 0, headDy: 2, headDx: 0, eyes: 'down' };
    case 'sleep': return { bodyDy: frame === 1 || frame === 2 ? 1 : 0, headDy: [1, 2, 4, 2][frame], headDx: frame === 2 ? 1 : 0, eyes: 'closed' };
    case 'stand': return { bodyDy: -STAND_RISE, headDy: -STAND_RISE + frame, headDx: 0, eyes: 'open' };
    case 'walk': return { bodyDy: -STAND_RISE - 1 + frame, headDy: -STAND_RISE - 1 + frame, headDx: 0, eyes: 'open' };
    // 舉手拉吊環：整個人低一點，留出舉起的手的空間
    case 'hang': return { bodyDy: -2, headDy: -2 + frame, headDx: 0, eyes: 'open' };
  }
}

/** 女生的上班族與學生穿裙子，其餘穿長褲 */
const wearsSkirt = (l: Look) => l.gender === 'f' && (l.avatar === 'office' || l.avatar === 'student');

function drawCharacter(p: Painter, ox: number, oy: number, look: Look, anim: Anim, frame: number, pal: Palette) {
  const R = (x: number, y: number, w: number, h: number, c: string) => p.rect(ox + x, oy + y, w, h, c);
  const { avatar, gender, view, o } = look;
  const pose = poseOf(anim, frame);
  const standing = anim === 'stand' || anim === 'walk' || anim === 'hang';
  const ty = 26 + pose.bodyDy;
  const hx = 25 + pose.headDx;
  const hy = 8 + pose.headDy;
  const bottomLo = shade(o.bottom, 0.86);
  const legs = wearsSkirt(look) ? mix(pal.skinLo, pal.shoe, 0.25) : bottomLo;
  const phones = avatar === 'headphone' ? o.acc : mix(o.hair, pal.metal, 0.5);
  const elder = avatar === 'elder';
  // 長者一律短髮（阿嬤燙捲）
  const longHair = gender === 'f' && !elder;

  // 下半身
  if (standing) {
    // 走路時兩腳交替抬起
    const lift = anim === 'walk' ? [2, 0][frame] : 0;
    const liftR = anim === 'walk' ? [0, 2][frame] : 0;
    const hip = ty + 20;
    if (wearsSkirt(look)) {
      R(22, hip, 20, 8, o.bottom);
      R(21, hip + 5, 22, 3, o.bottom);
      R(25, hip + 8, 5, 59 - hip - 8 - lift, legs); R(34, hip + 8, 5, 59 - hip - 8 - liftR, legs);
    } else {
      R(22, hip, 20, 4, o.bottom);
      R(23, hip + 4, 8, 59 - hip - 4 - lift, o.bottom); R(33, hip + 4, 8, 59 - hip - 4 - liftR, o.bottom);
      R(31, hip + 4, 2, 59 - hip - 4, bottomLo);
    }
    R(23, 59 - lift, 8, 3, pal.shoe); R(33, 59 - liftR, 8, 3, pal.shoe);
  } else if (view === 'front') {
    // 坐姿正面：大腿朝前、小腿垂下
    R(24, 52, 6, 7, legs); R(34, 52, 6, 7, legs);
    R(23, 59, 7, 3, pal.shoe); R(34, 59, 7, 3, pal.shoe);
    R(21, 46, 22, 7, o.bottom);
    if (wearsSkirt(look)) R(21, 52, 22, 1, shade(o.bottom, 0.8));
  }

  // 背面的長髮在軀幹前畫，正面的長髮在頭後方
  if (avatar === 'hoodie') R(23, 18 + pose.headDy, 18, 9, o.topLo); // 帽兜
  if (longHair && view === 'front') R(hx - 2, hy + 2, 18, avatar === 'hoodie' ? 14 : 20, o.hair);

  // 軀幹（女生肩膀窄一點）
  const bx = gender === 'f' ? 22 : 21;
  const bw = gender === 'f' ? 20 : 22;
  const torsoH = standing ? 20 : 46 - ty;
  R(bx, ty, bw, torsoH, o.top);
  R(bx + bw - 3, ty + 1, 3, torsoH - 1, o.topLo);
  p.clear(ox + bx, oy + ty, 1, 1);
  p.clear(ox + bx + bw - 1, oy + ty, 1, 1);

  // 頸
  R(30, Math.min(hy + 14, ty), 4, Math.max(1, ty - (hy + 14) + 1), pal.skinLo);

  if (view === 'front') {
    if (avatar === 'office') {
      if (gender === 'm') { R(30, ty, 4, 4, o.acc); R(31, ty + 4, 2, 1, o.acc); }
      else { R(28, ty, 8, 2, o.acc); R(31, ty + 2, 2, 2, o.acc); } // 襯衫領口
    }
    if (avatar === 'student') { R(bx + 4, ty, bw - 8, 1, o.acc); R(31, ty + 1, 2, 3, o.acc); }
    if (avatar === 'hoodie') { R(29, ty + 1, 1, 4, o.acc); R(34, ty + 1, 1, 4, o.acc); }
  } else if (avatar === 'hoodie') {
    R(23, ty - 1, 18, 6, o.topLo);
  }

  // 手臂與道具
  const armL = () => { R(bx - 3, ty + 2, 3, 15, o.topLo); R(bx - 2, ty + 17, 3, 3, pal.skin); };
  const armR = () => { R(bx + bw, ty + 2, 3, 15, o.topLo); R(bx + bw - 1, ty + 17, 3, 3, pal.skin); };
  if (standing && anim === 'walk') {
    // 擺手：前後擺動時手臂看起來長短不同
    const swing = frame === 0 ? 2 : -2;
    R(bx - 3, ty + 2, 3, 15 + swing, o.topLo); R(bx - 2, ty + 17 + swing, 3, 3, pal.skin);
    R(bx + bw, ty + 2, 3, 15 - swing, o.topLo); R(bx + bw - 1, ty + 17 - swing, 3, 3, pal.skin);
  } else if (anim === 'hang') {
    // 右手舉高握住吊環（吊環本身由車廂場景畫）
    armL();
    R(bx + bw, 2, 3, ty, o.topLo);
    R(bx + bw, 0, 3, 3, pal.skin);
  } else if (view === 'front' && anim === 'read') {
    armL();
    R(bx + bw, ty + 2, 3, 9, o.topLo);
    R(22, ty + 10, 6, 3, o.topLo); R(36, ty + 10, 6, 3, o.topLo);
    const cover = mix('#B97A6F', pal.wallShade, 0.25);
    R(24, ty + 5, 16, 10, cover);
    R(25, ty + 5, 14, 9, pal.paper);
    R(31, ty + 5, 2, 9, shade(pal.paper, 0.86));
    for (let x = 26; x < 30; x += 2) { R(x, ty + 8, 1, 1, pal.wallShade); R(x + 8, ty + 8, 1, 1, pal.wallShade); R(x, ty + 11, 1, 1, pal.wallShade); R(x + 8, ty + 11, 1, 1, pal.wallShade); }
    if (frame === 2) R(33, ty + 2, 5, 4, pal.paper);
    R(23, ty + 11, 3, 3, pal.skin); R(38, ty + 11, 3, 3, pal.skin);
  } else {
    armL();
    armR();
  }

  // 頭
  if (view === 'front') {
    if (!longHair && (avatar === 'student' || avatar === 'headphone')) R(hx - 1, hy + 2, 16, avatar === 'student' ? 12 : 15, o.hair);
    R(hx + 1, hy + 2, 12, 12, pal.skin);
    R(hx, hy + 4, 14, 8, pal.skin);
    R(hx, hy, 14, 4, o.hair);
    R(hx - 1, hy + 2, 1, 5, o.hair); R(hx + 14, hy + 2, 1, 5, o.hair);
    if (longHair) {
      // 斜瀏海
      R(hx + 1, hy + 4, 7, 1, o.hair); R(hx + 1, hy + 5, 3, 1, o.hair);
    } else {
      R(hx + 1, hy + 4, avatar === 'office' ? 3 : 6, 1, o.hair);
    }
    if (pose.eyes === 'open') { R(hx + 3, hy + 8, 1, 2, pal.eye); R(hx + 10, hy + 8, 1, 2, pal.eye); }
    else { R(hx + 3, hy + 9, 2, 1, pal.eye); R(hx + 9, hy + 9, 2, 1, pal.eye); }
    if (longHair && pose.eyes === 'open') { R(hx + 2, hy + 7, 1, 1, pal.eye); R(hx + 11, hy + 7, 1, 1, pal.eye); }
    const blush = mix(pal.skin, '#C98BA0', longHair ? 0.5 : 0.35);
    R(hx + 2, hy + 11, 2, 1, blush); R(hx + 10, hy + 11, 2, 1, blush);
  } else {
    R(hx, hy, 14, 14, o.hair);
    R(hx - 1, hy + 2, 16, 9, o.hair);
    R(hx - 1, hy + 7, 1, 2, pal.skin); R(hx + 14, hy + 7, 1, 2, pal.skin);
    if (longHair) {
      // 長髮蓋過肩膀；連帽外套女生綁馬尾
      if (avatar === 'hoodie') { R(hx + 5, hy + 12, 4, 8, o.hair); R(hx + 6, hy + 20, 2, 2, o.hair); }
      else { R(hx - 1, hy + 11, 16, 9, o.hair); R(hx, hy + 20, 14, 1, shade(o.hair, 0.85)); }
    } else if (avatar === 'student' || avatar === 'headphone') {
      R(hx, hy + 12, 14, 3, o.hair);
    }
  }

  if (elder && view === 'front') {
    // 灰白捲髮／鴨舌帽、眼角的細紋
    if (gender === 'f') { R(hx - 2, hy - 1, 18, 4, o.hair); R(hx - 2, hy + 3, 2, 5, o.hair); R(hx + 14, hy + 3, 2, 5, o.hair); }
    else { R(hx - 1, hy - 1, 16, 3, o.acc); R(hx + 1, hy + 2, 14, 1, shade(o.acc, 0.8)); }
    R(hx + 1, hy + 10, 1, 1, pal.skinLo); R(hx + 12, hy + 10, 1, 1, pal.skinLo);
  } else if (elder) {
    if (gender === 'f') R(hx - 2, hy - 1, 18, 5, o.hair);
    else R(hx - 1, hy - 1, 16, 4, o.acc);
  }
  if (elder) drawBasket(R, look, anim, view, ty, bx, pal);
  if (avatar === 'parent') drawChild(R, look, anim, view, pose, pal);

  if (anim === 'music') {
    R(hx - 1, hy - 2, 16, 2, phones);
    R(hx - 2, hy + 5, 3, 5, phones); R(hx + 13, hy + 5, 3, 5, phones);
  } else if (avatar === 'headphone') {
    R(26, ty - 2, 3, 3, phones); R(35, ty - 2, 3, 3, phones); // 掛在脖子上
  }
}

type Rect = (x: number, y: number, w: number, h: number, c: string) => void;

/** 長者的菜籃：站著時拎在左手，坐著時放在腿上（背面坐姿看不到） */
function drawBasket(R: Rect, look: Look, anim: Anim, view: View, ty: number, bx: number, pal: Palette) {
  const rattan = mix('#C9A46A', pal.wallShade, 0.2);
  const weave = shade(rattan, 0.78);
  const green = mix('#7FA98A', pal.wallShade, 0.15);
  const standing = anim === 'stand' || anim === 'walk' || anim === 'hang';
  if (standing) {
    const x = bx - 10;
    const y = ty + 21 + (anim === 'walk' ? 1 : 0);
    R(x + 2, y - 4, 1, 4, weave); R(x + 9, y - 4, 1, 4, weave); R(x + 2, y - 5, 8, 1, weave);
    R(x + 3, y - 3, 2, 4, green); R(x + 6, y - 4, 2, 5, green);
    R(x, y, 12, 8, rattan);
    R(x, y + 3, 12, 1, weave); R(x, y + 6, 12, 1, weave);
    R(x + 4, y, 1, 8, weave);
  } else if (view === 'front') {
    R(25, 41, 14, 7, rattan);
    R(25, 44, 14, 1, weave);
    R(27, 37, 2, 4, green); R(31, 36, 2, 5, green); R(35, 38, 2, 3, green);
  }
  void look;
}

/** 家長牽著的小朋友：站著時在左邊牽手，坐著時坐在腿上（背面坐姿只露出頭） */
function drawChild(R: Rect, look: Look, anim: Anim, view: View, pose: Pose, pal: Palette) {
  const shirt = look.o.acc;
  const hair = shade(look.o.hair, 1.05);
  const standing = anim === 'stand' || anim === 'walk' || anim === 'hang';
  const asleep = anim === 'sleep';
  if (standing) {
    const bob = anim === 'walk' ? [0, 1][pose.headDy % 2 === 0 ? 0 : 1] : 0;
    const top = 33 + bob;
    // 頭
    R(9, top, 9, 8, view === 'front' ? pal.skin : hair);
    R(9, top, 9, 3, hair);
    if (view === 'front') { R(11, top + 5, 1, 1, pal.eye); R(15, top + 5, 1, 1, pal.eye); }
    // 身體、舉起來牽著大人的手
    R(9, top + 8, 9, 10, shirt);
    R(18, top + 4, 2, 6, shirt); R(18, top + 3, 2, 2, pal.skin);
    R(7, top + 9, 2, 6, shirt); R(7, top + 15, 2, 2, pal.skin);
    const lift = anim === 'walk' ? [1, 0][pose.headDy % 2 === 0 ? 0 : 1] : 0;
    R(10, top + 18, 3, 9 - lift, look.o.bottom); R(14, top + 18, 3, 9 - (1 - lift) * (anim === 'walk' ? 1 : 0), look.o.bottom);
    R(10, 59, 3, 2, pal.shoe); R(14, 59, 3, 2, pal.shoe);
  } else if (view === 'front') {
    R(27, 29, 10, 8, pal.skin);
    R(27, 29, 10, 3, hair);
    if (asleep) { R(29, 34, 2, 1, pal.eye); R(33, 34, 2, 1, pal.eye); }
    else { R(29, 34, 1, 1, pal.eye); R(34, 34, 1, 1, pal.eye); }
    R(26, 37, 12, 10, shirt);
    R(27, 47, 4, 6, look.o.bottom); R(33, 47, 4, 6, look.o.bottom);
    R(27, 53, 4, 2, pal.shoe); R(33, 53, 4, 2, pal.shoe);
  } else {
    // 從背後看：小朋友的頭從大人肩膀旁冒出來
    R(41, 24 + (asleep ? 2 : 0), 8, 7, hair);
  }
}
