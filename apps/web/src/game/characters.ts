// 乘客角色：64 × 64 cell，每個動作 2～4 幀（docs/PRD.md §2.3、§21.5）。4 種穿搭＋長者、家長（第 20 章）× 男／女 × 正面／背面。
// 美術是 scripts/pixel/atlas.py 依角色設定頁預覽圖的畫風逐格畫好的圖集（assets/characters/atlas.png）。
import { CanvasSource, type Texture } from 'pixi.js';
import { AVATARS, SPECIAL_KINDS, type AvatarId, type Gender, type Mode, type PaxState } from '@cc/shared';
import { atlasFrames, makeCanvas } from './paint';
import atlasUrl from '../assets/characters/atlas.png';
import headphonesFemaleUrl from '../assets/characters/commuter-headphones-female.png';
import headphonesMaleUrl from '../assets/characters/commuter-headphones-male.png';
import hoodieFemaleUrl from '../assets/characters/commuter-hoodie-female.png';
import hoodieMaleUrl from '../assets/characters/commuter-hoodie-male.png';
import officeFemaleUrl from '../assets/characters/commuter-office-female.png';
import officeMaleUrl from '../assets/characters/commuter-office-male.png';
import studentFemaleUrl from '../assets/characters/commuter-student-female.png';
import studentMaleUrl from '../assets/characters/commuter-student-male.png';

export const CELL = 64;
export type View = 'front' | 'back';
/** 坐著的狀態之外，還會站著、走路、在走道上拉吊環 */
export type Anim = PaxState | 'stand' | 'walk' | 'hang';

/** 每個動作在 atlas 一列中的欄位（要和 atlas.py 的 FRAMES 一致） */
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

const COLUMNS = 17;
const ALL_AVATARS: AvatarId[] = [...AVATARS, ...SPECIAL_KINDS];
const GENDERS: Gender[] = ['m', 'f'];
const rowOf = (a: number, g: number, v: number) => (a * GENDERS.length + g) * 2 + v;

/** 夜間把角色壓暗、偏一點藍紫，和夜間車廂一致 */
const NIGHT_TINT = [0.8, 0.78, 0.86] as const;
/** 系統 NPC 偏淡的莫蘭迪色階（docs/PRD.md §24.1）：先褪一點彩度，再往燕麥色提亮 */
const NPC_DESATURATE = 0.2;
const NPC_LIFT = 0.14;
const NPC_LIFT_TO = { morning: [232, 225, 213], night: [150, 145, 160] } as const;

const atlasImage = loadImage(atlasUrl);
/** 角色圖集載好了（進場景前要等） */
export const characterArtReady = atlasImage.decode().catch(() => {});

type FrameTree = Record<AvatarId, Record<Gender, Record<View, Texture[]>>>;
/** 真人的貼圖；pale 是同一套動作、給系統 NPC 用的偏淡版本 */
export type CharacterFrames = FrameTree & { pale: FrameTree };

export function buildCharacterAtlas(mode: Mode): CharacterFrames {
  const real = paintAtlas(mode, false);
  return Object.assign(real, { pale: paintAtlas(mode, true) });
}

/** 釋放一整組貼圖（真人與 NPC 各自共用一張 atlas source） */
export function destroyCharacterAtlas(frames: CharacterFrames) {
  frames.office.m.front[0].destroy(true);
  frames.pale.office.m.front[0].destroy(true);
}

function paintAtlas(mode: Mode, pale: boolean): FrameTree {
  const { canvas, ctx } = makeCanvas(CELL * COLUMNS, CELL * ALL_AVATARS.length * GENDERS.length * 2);
  if (atlasImage.complete && atlasImage.naturalWidth) ctx.drawImage(atlasImage, 0, 0);
  if (mode === 'night' || pale) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const lift = NPC_LIFT_TO[mode];
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      if (mode === 'night') {
        d[i] *= NIGHT_TINT[0];
        d[i + 1] *= NIGHT_TINT[1];
        d[i + 2] *= NIGHT_TINT[2];
      }
      if (pale) {
        const y = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        for (let c = 0; c < 3; c++) {
          const v = d[i + c] + (y - d[i + c]) * NPC_DESATURATE;
          d[i + c] = v + (lift[c] - v) * NPC_LIFT;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const source = new CanvasSource({ resource: canvas });
  const out = {} as FrameTree;
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

/** 角色設定頁的全身預覽圖（64×64，頭頂第 4 列、腳底第 61 列；四套穿搭男女同一個位置，切換時像在原地換衣服） */
const PREVIEW_ART: Partial<Record<AvatarId, Record<Gender, HTMLImageElement>>> = {
  office: { f: loadImage(officeFemaleUrl), m: loadImage(officeMaleUrl) },
  student: { f: loadImage(studentFemaleUrl), m: loadImage(studentMaleUrl) },
  hoodie: { f: loadImage(hoodieFemaleUrl), m: loadImage(hoodieMaleUrl) },
  headphone: { f: loadImage(headphonesFemaleUrl), m: loadImage(headphonesMaleUrl) },
};
/** 預覽圖都載好（載不到也算完成，會改用遊戲圖集的站姿） */
export const previewArtReady = Promise.all(
  Object.values(PREVIEW_ART).flatMap(g => Object.values(g!)).map(img => img.decode().catch(() => {})),
).then(() => {});

function loadImage(src: string) {
  const img = new Image();
  img.src = src;
  return img;
}

/** 腰線：呼吸時這一列以上往下沉 1 px，腳底不動 */
const PREVIEW_WAIST = 44;

/** 閘門的角色預覽：在 64×64 的畫布上畫一格站姿（frame 0／1 輪流就是呼吸） */
export function paintPreview(ctx: CanvasRenderingContext2D, avatar: AvatarId, gender: Gender, frame: number) {
  ctx.clearRect(0, 0, CELL, CELL);
  const art = PREVIEW_ART[avatar]?.[gender];
  if (art?.complete && art.naturalWidth) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(art, 0, PREVIEW_WAIST, CELL, CELL - PREVIEW_WAIST, 0, PREVIEW_WAIST, CELL, CELL - PREVIEW_WAIST);
    ctx.drawImage(art, 0, 0, CELL, PREVIEW_WAIST, 0, frame, CELL, PREVIEW_WAIST);
    return;
  }
  // 沒有預覽圖時（長者、家長）用遊戲圖集的正面站姿
  if (atlasImage.complete && atlasImage.naturalWidth) {
    const a = ALL_AVATARS.indexOf(avatar);
    const g = GENDERS.indexOf(gender);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlasImage, FRAMES.stand[frame] * CELL, rowOf(a, g, 0) * CELL, CELL, CELL, 0, 0, CELL, CELL);
  }
}
