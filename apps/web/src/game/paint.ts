// 程序化像素繪圖工具：M0 階段先以程式畫出占位美術，之後由 Aseprite Atlas 取代。
import { CanvasSource, Rectangle, Texture, type TextureSource } from 'pixi.js';

export function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export class Painter {
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1) {
    if (w <= 0 || h <= 0) return;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    this.ctx.globalAlpha = 1;
  }

  px(x: number, y: number, color: string, alpha = 1) {
    this.rect(x, y, 1, 1, color, alpha);
  }

  clear(x: number, y: number, w: number, h: number) {
    this.ctx.clearRect(x, y, w, h);
  }

  /** 四角各缺一個像素的圓角矩形 */
  round(x: number, y: number, w: number, h: number, color: string) {
    this.rect(x + 1, y, w - 2, h, color);
    this.rect(x, y + 1, 1, h - 2, color);
    this.rect(x + w - 1, y + 1, 1, h - 2, color);
  }

  /** 以 1 px 抖色在兩色之間做垂直漸層 */
  gradient(x: number, y: number, w: number, h: number, top: string, bottom: string, bands = 6) {
    const bandH = h / bands;
    for (let b = 0; b < bands; b++) {
      const color = mix(top, bottom, b / (bands - 1));
      this.rect(x, y + b * bandH, w, Math.ceil(bandH), color);
      if (b > 0) {
        const prev = mix(top, bottom, (b - 1) / (bands - 1));
        const yy = Math.round(y + b * bandH);
        for (let xx = x; xx < x + w; xx += 2) this.px(xx + (yy % 2), yy, prev);
      }
    }
  }
}

export function canvasTexture(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

export function paint(w: number, h: number, draw: (p: Painter) => void): Texture {
  const { canvas, ctx } = makeCanvas(w, h);
  draw(new Painter(ctx));
  return canvasTexture(canvas);
}

/** 由一張大畫布切出多個 frame，共用同一個 TextureSource（等同 Atlas） */
export function atlasFrames(source: TextureSource, cell: number, count: number, row: number): Texture[] {
  return Array.from({ length: count }, (_, i) => new Texture({ source, frame: new Rectangle(i * cell, row * cell, cell, cell) }));
}

export function mix(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** 可重現的亂數（同一個種子每次畫出相同的占位美術） */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
