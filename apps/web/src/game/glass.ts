// 車窗玻璃：水蒸氣霧氣、霧氣留言（寫字處擦開，再慢慢重新凝結）、沿玻璃滑落的水珠（docs/PRD.md §2.4、§4.5）
import { CanvasSource, Sprite, Texture } from 'pixi.js';
import { NOTE_MAX_GRAPHEMES, splitGraphemes } from '@cc/shared';
import { WIN, windowRect } from './layout';
import { mix, makeCanvas, rng } from './paint';
import { shade, type Palette } from './palette';

const GW = WIN.w;
const GH = WIN.h;
const FOG_TILE = GW * 2;
/** 留言寫下後保持清晰的秒數 */
const CLEAR_SEC = 20;
// 粗一點、大一點，字與字之間留 1 px：二值化後筆劃不會黏在一起
const NOTE_FONT = '700 13px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const NOTE_PX = 13;
const LETTER_SPACING = 1;
const LINE_H = 16;
const CHARS_PER_LINE = 4;

interface Droplet { x: number; y: number; mass: number; sliding: boolean; vy: number; wobble: number }

interface Note {
  createdAt: number;
  ttlMs: number;
  /** 每個字形像素的消散門檻（0..1），霧氣依此有機地重新凝結 */
  pixels: { i: number; n: number }[];
  /** 筆劃外緣：緊貼的一圈深色水痕（亮背景時看得清），再外一圈亮白霧氣（暗背景時看得清） */
  rim: { i: number; n: number; dark: boolean }[];
  bucket: number;
}

export class WindowGlass {
  readonly sprite: Sprite;
  private ctx: CanvasRenderingContext2D;
  private source: CanvasSource;
  private fog!: HTMLCanvasElement;
  private trails = makeCanvas(GW, GH);
  private mask = makeCanvas(GW, GH);
  private rim = makeCanvas(GW, GH);
  private rimDark: [number, number, number] = [0, 0, 0];
  private rimLight: [number, number, number] = [255, 255, 255];
  private drops: Droplet[] = [];
  private note: Note | null = null;
  private fogOffset = 0;
  private dropColor = '#ffffff';
  private fogAlpha = 0.5;

  constructor(readonly index: number) {
    const { canvas, ctx } = makeCanvas(GW, GH);
    this.ctx = ctx;
    this.source = new CanvasSource({ resource: canvas });
    this.sprite = new Sprite(new Texture({ source: this.source }));
    const r = windowRect(index);
    this.sprite.position.set(r.x, r.y);
  }

  setPalette(pal: Palette, night: boolean) {
    this.fog = buildFogTile(pal.fog, 100 + this.index);
    this.dropColor = pal.glow;
    this.fogAlpha = night ? 0.55 : 0.42;
    const rgb = (hex: string): [number, number, number] => {
      const n = parseInt(hex.slice(1), 16);
      return [n >> 16, (n >> 8) & 255, n & 255];
    };
    this.rimDark = rgb(shade(pal.fog, night ? 0.22 : 0.38));
    this.rimLight = rgb(mix(pal.fog, '#ffffff', 0.6));
    if (this.note) this.note.bucket = -1;
  }

  get hasNote() {
    return this.note !== null;
  }

  /** 檢舉移除，或玩家「擦掉」（只有自己看不到） */
  clearNote() {
    this.note = null;
  }

  writeNote(text: string, ttlMs: number, now: number) {
    const chars = splitGraphemes(text).slice(0, NOTE_MAX_GRAPHEMES);
    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += CHARS_PER_LINE) lines.push(chars.slice(i, i + CHARS_PER_LINE).join(''));

    // 以系統中文字型畫字，再二值化成像素筆劃（正式版改用像素字型 Cubic 11）
    const { ctx } = makeCanvas(GW, GH);
    ctx.font = NOTE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const top = GH / 2 - ((lines.length - 1) * LINE_H) / 2;
    lines.forEach((line, row) => {
      // 逐字排版，才能控制字距
      const glyphs = splitGraphemes(line);
      const widths = glyphs.map(g => Math.max(ctx.measureText(g).width, NOTE_PX * 0.55));
      const total = widths.reduce((a, b) => a + b, 0) + LETTER_SPACING * (glyphs.length - 1);
      let x = (GW - total) / 2;
      glyphs.forEach((g, k) => {
        ctx.fillText(g, Math.round(x + widths[k] / 2), Math.round(top + row * LINE_H));
        x += widths[k] + LETTER_SPACING;
      });
    });
    const data = ctx.getImageData(0, 0, GW, GH).data;
    const noise = rng(now % 100000);
    const pixels: Note['pixels'] = [];
    const stroke = new Set<number>();
    for (let i = 0; i < GW * GH; i++) {
      if (data[i * 4 + 3] > 110) {
        pixels.push({ i, n: noise() });
        stroke.add(i);
      }
    }
    // 第一圈（八方向＋右下陰影）是深色描邊，第二圈是亮白霧氣
    const rim: Note['rim'] = [];
    const seen = new Set<number>(stroke);
    const ring = (from: Iterable<number>, dark: boolean, dirs: number[][]) => {
      const out: number[] = [];
      for (const i of from) {
        const x = i % GW, y = Math.floor(i / GW);
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          const j = ny * GW + nx;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || seen.has(j)) continue;
          seen.add(j);
          out.push(j);
          rim.push({ i: j, n: noise(), dark });
        }
      }
      return out;
    };
    const eight = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    const inner = ring(stroke, true, [...eight, [2, 2]]);
    ring(inner, false, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
    this.note = { createdAt: now, ttlMs, pixels, rim, bucket: -1 };
  }

  /** 每次約 50 ms 呼叫一次：重繪霧、字、水珠並上傳貼圖 */
  update(dt: number, now: number, raining: boolean, speed: number, reducedMotion: boolean) {
    this.simulateDrops(dt, raining, speed, reducedMotion);
    const { ctx } = this;
    ctx.clearRect(0, 0, GW, GH);

    // 霧：雨天更濃；緩慢流動
    if (!reducedMotion) this.fogOffset = (this.fogOffset + dt * 1.5) % FOG_TILE;
    const off = Math.round(this.fogOffset);
    ctx.globalAlpha = Math.min(0.75, this.fogAlpha + (raining ? 0.12 : 0));
    ctx.drawImage(this.fog, -off, 0);
    ctx.drawImage(this.fog, FOG_TILE - off, 0);
    ctx.globalAlpha = 1;

    // 寫字與水痕的地方把霧擦掉
    ctx.globalCompositeOperation = 'destination-out';
    if (this.note) this.drawNoteMask(now);
    if (this.note) ctx.drawImage(this.mask.canvas, 0, 0);
    ctx.drawImage(this.trails.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (this.note) ctx.drawImage(this.rim.canvas, 0, 0);

    for (const d of this.drops) {
      const size = d.mass < 0.5 ? 1 : d.mass < 1.1 ? 2 : 3;
      const x = Math.round(d.x);
      const y = Math.round(d.y);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = this.dropColor;
      ctx.fillRect(x, y, size, size);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y + size, size, 1);
      ctx.globalAlpha = 1;
    }
    this.source.update();
  }

  private drawNoteMask(now: number) {
    const note = this.note!;
    const age = now - note.createdAt;
    const fadeSpan = Math.max(1, note.ttlMs - CLEAR_SEC * 1000);
    const k = Math.min(1, Math.max(0, (age - CLEAR_SEC * 1000) / fadeSpan));
    const clarity = 1 - k * k * (3 - 2 * k);
    if (clarity <= 0) {
      this.note = null;
      return;
    }
    const bucket = Math.round(clarity * 40);
    if (bucket === note.bucket) return;
    note.bucket = bucket;
    const { ctx } = this.mask;
    const img = ctx.createImageData(GW, GH);
    for (const { i, n } of note.pixels) if (n < clarity * 1.08) img.data[i * 4 + 3] = 235;
    ctx.putImageData(img, 0, 0);

    const rimImg = this.rim.ctx.createImageData(GW, GH);
    for (const { i, n, dark } of note.rim) {
      if (n >= clarity * 1.08) continue;
      rimImg.data.set(dark ? [...this.rimDark, 215] : [...this.rimLight, 190], i * 4);
    }
    this.rim.ctx.putImageData(rimImg, 0, 0);
  }

  private simulateDrops(dt: number, raining: boolean, speed: number, reducedMotion: boolean) {
    // 水痕慢慢被霧重新蓋住
    const t = this.trails.ctx;
    t.globalCompositeOperation = 'destination-out';
    t.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 0.6)})`;
    t.fillRect(0, 0, GW, GH);
    t.globalCompositeOperation = 'source-over';

    if (raining && this.drops.length < 26 && Math.random() < dt * 1.6) {
      this.drops.push({ x: Math.random() * GW, y: Math.random() * GH * 0.8, mass: 0.2 + Math.random() * 0.5, sliding: false, vy: 0, wobble: 0 });
    }
    const drift = reducedMotion ? 0 : -speed * 10;
    for (const d of this.drops) {
      if (!d.sliding) {
        d.mass += dt * (raining ? 0.05 : -0.02);
        if (d.mass > 1.05 && !reducedMotion) d.sliding = true;
        continue;
      }
      d.vy = Math.min(38, d.vy + dt * 30 * d.mass);
      d.y += d.vy * dt;
      d.wobble += dt;
      d.x += drift * dt + (d.wobble > 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0);
      if (d.wobble > 0.4) d.wobble = 0;
      t.fillStyle = 'rgba(255,255,255,0.9)';
      t.fillRect(Math.round(d.x), Math.round(d.y) - 2, 2, 3);
      // 滑過其他水珠就吞併它，越滾越快
      for (const o of this.drops) {
        if (o !== d && !o.sliding && o.mass > 0 && Math.abs(o.x - d.x) < 2 && Math.abs(o.y - d.y) < 2) {
          d.mass += o.mass * 0.6;
          o.mass = -1;
        }
      }
    }
    this.drops = this.drops.filter(d => d.mass > 0 && d.y < GH && d.x > -3 && d.x < GW + 3);
  }
}

/** 可水平循環的霧氣雜訊：下緣較濃 */
function buildFogTile(color: string, seed: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(FOG_TILE, GH);
  const r = rng(seed);
  const cell = 8;
  const cols = FOG_TILE / cell;
  const rows = Math.ceil(GH / cell) + 1;
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => r()));
  const at = (gx: number, gy: number) => grid[Math.min(rows - 1, gy)][((gx % cols) + cols) % cols];
  const img = ctx.createImageData(FOG_TILE, GH);
  const n = parseInt(color.slice(1), 16);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < FOG_TILE; x++) {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      const fx = (x % cell) / cell, fy = (y % cell) / cell;
      const top = at(gx, gy) * (1 - fx) + at(gx + 1, gy) * fx;
      const bottom = at(gx, gy + 1) * (1 - fx) + at(gx + 1, gy + 1) * fx;
      const v = top * (1 - fy) + bottom * fy;
      // 量化成 4 階，維持像素顆粒感
      const level = Math.floor((0.45 + 0.55 * v) * (0.55 + 0.45 * (y / GH)) * 4) / 4;
      const k = (y * FOG_TILE + x) * 4;
      img.data[k] = n >> 16;
      img.data[k + 1] = (n >> 8) & 255;
      img.data[k + 2] = n & 255;
      img.data[k + 3] = Math.round(level * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
