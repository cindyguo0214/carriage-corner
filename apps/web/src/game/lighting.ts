// 像素化光照：所有光斑以 2 px 網格繪製、4 階亮度量化，放大後仍是一圈圈的像素光暈（docs/PRD.md §2.4）
import { Graphics } from 'pixi.js';
import type { Mode } from '@cc/shared';
import { CEIL_H, FLOOR_Y, H, W, windowRect } from './layout';
import { hexToNum, type Palette } from './palette';
import type { Scenery } from './scenery';
import { NEAR_PX, type Train } from './train';

const q = (v: number) => Math.round(v / 2) * 2;
/** 由內而外的四階亮度 */
const STEPS = [1, 0.55, 0.3, 0.14];

interface NeonPatch { x: number; color: number }
interface Glow { x: number; y: number; t: number; color: number }

export class Lighting {
  readonly view = new Graphics();
  private neon: NeonPatch[] = [];
  private neonTimer = 2;
  private glows: Glow[] = [];
  private pal!: Palette;
  private mode: Mode = 'night';
  private time = 0;

  constructor() {
    this.view.blendMode = 'add';
  }

  setPalette(pal: Palette, mode: Mode) {
    this.pal = pal;
    this.mode = mode;
    this.neon = [];
  }

  addGlow(x: number, y: number) {
    this.glows.push({ x, y, t: 0, color: hexToNum(this.pal.glow) });
  }

  update(dt: number, train: Train, scenery: Scenery, reducedMotion: boolean) {
    this.time += dt;
    const g = this.view;
    g.clear();
    const outdoor = !train.inTunnel;

    if (outdoor && this.mode === 'morning') this.drawSunPatches(reducedMotion);
    if (outdoor && this.mode === 'night') this.updateNeon(dt, train, reducedMotion);
    if (!outdoor) this.drawTunnelSweeps(scenery, train, reducedMotion);

    if (scenery.portalFlash > 0) {
      g.rect(0, CEIL_H, W, H - CEIL_H).fill({ color: hexToNum(this.pal.light), alpha: 0.22 * quantize(scenery.portalFlash) });
    }

    this.glows = this.glows.filter(gl => (gl.t += dt) < 1.2);
    for (const gl of this.glows) {
      const a = gl.t < 0.2 ? gl.t / 0.2 : 1 - (gl.t - 0.2) / 1;
      this.steppedRect(gl.x - 10, gl.y - 10, 20, 18, gl.color, 0.35 * quantize(a), 3);
    }
  }

  /** 晨間：陽光穿過車窗，在地板與前排椅背上留下窗形光斑，隨列車轉彎緩慢移動 */
  private drawSunPatches(reducedMotion: boolean) {
    const drift = reducedMotion ? 0 : Math.sin(this.time / 9) * 10;
    const color = hexToNum(this.pal.light);
    for (let i = 0; i < 6; i++) {
      const r = windowRect(i);
      this.floorPatch(r.x + 26 + drift, color, 0.12);
    }
  }

  /** 夜間：窗外經過的霓虹招牌，色光透過窗框掃過地板 */
  private updateNeon(dt: number, train: Train, reducedMotion: boolean) {
    const speed = train.speed * NEAR_PX * 0.8;
    this.neonTimer -= dt;
    if (this.neonTimer <= 0 && train.speed > 0.2 && !reducedMotion) {
      const colors = this.pal.neon;
      this.neon.push({ x: W + 40, color: hexToNum(colors[Math.floor(Math.random() * colors.length)]) });
      this.neonTimer = 1.5 + Math.random() * 3;
    }
    this.neon = this.neon.filter(n => (n.x -= speed * dt) > -140);
    for (const n of this.neon) {
      this.floorPatch(n.x, n.color, 0.2);
      this.steppedRect(n.x - 40, 134, 52, 26, n.color, 0.08, 2);
    }
    // 車廂燈本身的暖光：天花板燈帶下方一道柔光
    this.steppedRect(0, 30, W, 10, hexToNum(this.pal.light), 0.05, 2);
  }

  /** 隧道燈從窗外掃過時，在車廂內投下一道明暗（頻率 < 3 Hz） */
  private drawTunnelSweeps(scenery: Scenery, train: Train, reducedMotion: boolean) {
    const color = hexToNum(this.pal.light);
    if (train.phase === 'dwell' || reducedMotion) {
      for (let i = 0; i < 6; i++) this.floorPatch(windowRect(i).x + 20, color, 0.07);
      return;
    }
    for (const x of scenery.tunnelLightXs) {
      this.steppedRect(x - 10, CEIL_H + 2, 20, FLOOR_Y + 60 - CEIL_H, color, 0.05, 3);
    }
  }

  /** 窗形光斑投射到地板：平行四邊形，逐列位移 1 px */
  private floorPatch(x: number, color: number, alpha: number) {
    const g = this.view;
    for (let s = STEPS.length - 1; s >= 0; s--) {
      const grow = s * 2;
      for (let row = 0; row < 36; row += 2) {
        g.rect(q(x + row * 0.6 - grow), q(FLOOR_Y + 12 + row - grow), q(48 + grow * 2), 2).fill({ color, alpha: alpha * STEPS[s] });
      }
    }
  }

  private steppedRect(x: number, y: number, w: number, h: number, color: number, alpha: number, steps: number) {
    const g = this.view;
    for (let s = steps - 1; s >= 0; s--) {
      const grow = s * 2;
      g.rect(q(x - grow), q(y - grow), q(w + grow * 2), q(h + grow * 2)).fill({ color, alpha: alpha * STEPS[s] });
    }
  }
}

/** 亮度只留 4 階 */
function quantize(v: number) {
  return Math.round(Math.min(1, Math.max(0, v)) * 4) / 4;
}
