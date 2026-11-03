// 車窗玻璃：水蒸氣霧氣、霧氣留言、沿玻璃滑落的水珠（docs/PRD.md §2.4、§4.5、§17.2）
// 霧與水珠畫在 640×360 的像素層；留言文字另外畫在螢幕解析度的疊層（textView），
// 這樣「繁、鬱、聽」這類多筆畫的字也有足夠的像素，筆劃之間不會黏在一起。
import { CanvasSource, Container, Sprite, Text, Texture } from 'pixi.js';
import { NOTE_MAX_GRAPHEMES, splitGraphemes } from '@cc/shared';
import { WIN, windowRect } from './layout';
import { mix, makeCanvas, rng } from './paint';
import { shade, type Palette } from './palette';

const GW = WIN.w;
const GH = WIN.h;
const FOG_TILE = GW * 2;
/** 留言寫下後保持清晰的秒數 */
const CLEAR_SEC = 20;
/** 細筆劃：一般字重，不用粗體、不加實心描邊 */
const NOTE_FAMILY = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Heiti TC", sans-serif';
/** 文字可用的寬度與起始高度（world px；窗框內留邊） */
const TEXT_W = GW - 6;
const TEXT_TOP = 4;
const TEXT_BOTTOM = GH - 8;
const CHARS_PER_LINE = 4;

interface Droplet { x: number; y: number; mass: number; sliding: boolean; vy: number; wobble: number }

interface Note {
  createdAt: number;
  ttlMs: number;
  /** 文字範圍（玻璃座標），在這裡霧氣會稍微濃一點，讓字的底色一致 */
  box: { x: number; y: number; w: number; h: number };
}

/** 多筆畫的字：先在小畫布上量墨量，墨量高的字放寬字距 */
const densityCache = new Map<string, number>();
function inkDensity(ch: string): number {
  let d = densityCache.get(ch);
  if (d !== undefined) return d;
  const { ctx } = makeCanvas(24, 24);
  ctx.font = `24px ${NOTE_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  ctx.fillText(ch, 0, 0);
  const data = ctx.getImageData(0, 0, 24, 24).data;
  let ink = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) ink++;
  d = ink / (24 * 24);
  densityCache.set(ch, d);
  return d;
}

/**
 * 動態字級：字少時大一點；一行有多筆畫的字時放寬字距，必要時縮小字級以塞進窗框。
 * 回傳每一行的字級與字距（world px）。
 */
function layoutNote(chars: string[]) {
  const perLine = chars.length <= 3 ? 3 : CHARS_PER_LINE;
  const lines: string[][] = [];
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine));
  const base = chars.length <= 3 ? 14 : 12;
  const probe = makeCanvas(1, 1).ctx;
  return lines.map(line => {
    const dense = line.some(ch => inkDensity(ch) > 0.3);
    const spacing = dense ? 1.4 : 0.7;
    let size = base;
    const width = (sz: number) => {
      probe.font = `${sz}px ${NOTE_FAMILY}`;
      return line.reduce((w, ch) => w + probe.measureText(ch).width, 0) + spacing * (line.length - 1);
    };
    while (size > 9 && width(size) > TEXT_W) size -= 0.5;
    return { text: line.join(''), size, spacing };
  });
}

export class WindowGlass {
  readonly sprite: Sprite;
  /** 螢幕解析度的文字疊層（由 Stage 以同樣的鏡頭轉換畫在最上層） */
  readonly textView = new Container();
  private ctx: CanvasRenderingContext2D;
  private source: CanvasSource;
  private fog!: HTMLCanvasElement;
  private fogColor = '#ffffff';
  private trails = makeCanvas(GW, GH);
  private drops: Droplet[] = [];
  private note: Note | null = null;
  private texts: Text[] = [];
  private inkColor = '#555555';
  private haloColor = '#ffffff';
  private resolution = 2;
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
    this.textView.position.set(r.x, r.y);
  }

  setPalette(pal: Palette, night: boolean) {
    this.fog = buildFogTile(pal.fog, 100 + this.index);
    this.fogColor = pal.fog;
    this.dropColor = pal.glow;
    this.fogAlpha = night ? 0.55 : 0.42;
    // 字是「擦開霧氣後露出的深色」，外圍一圈淡淡的亮霧光暈，讓筆劃在任何窗景前都分得開
    this.inkColor = shade(pal.fog, night ? 0.3 : 0.42);
    this.haloColor = mix(pal.fog, '#ffffff', 0.7);
    for (const t of this.texts) this.styleText(t, t.style.fontSize as number, t.style.letterSpacing as number);
  }

  /** 每個裝置像素對應多少 world px 的倒數：文字以這個解析度光柵化，放大後仍清晰 */
  setResolution(scale: number) {
    this.resolution = Math.max(1, Math.min(6, scale));
    for (const t of this.texts) t.resolution = this.resolution;
  }

  get hasNote() {
    return this.note !== null;
  }

  /** 檢舉移除，或玩家「擦掉」（只有自己看不到） */
  clearNote() {
    this.note = null;
    this.texts.forEach(t => t.destroy());
    this.texts = [];
  }

  writeNote(text: string, ttlMs: number, now: number) {
    this.clearNote();
    const chars = splitGraphemes(text).slice(0, NOTE_MAX_GRAPHEMES);
    const lines = layoutNote(chars);
    const lineH = (sz: number) => Math.round(sz * 1.25);
    const total = lines.reduce((h, l) => h + lineH(l.size), 0);
    let y = Math.max(TEXT_TOP, Math.round((TEXT_TOP + TEXT_BOTTOM) / 2 - total / 2));
    let maxW = 0;
    for (const l of lines) {
      const t = new Text({ text: l.text, resolution: this.resolution });
      this.styleText(t, l.size, l.spacing);
      t.anchor.set(0.5, 0);
      t.position.set(GW / 2, y);
      maxW = Math.max(maxW, t.width);
      this.textView.addChild(t);
      this.texts.push(t);
      y += lineH(l.size);
    }
    const top = y - total;
    this.note = {
      createdAt: now,
      ttlMs,
      box: { x: Math.round(GW / 2 - maxW / 2 - 3), y: top - 2, w: Math.round(maxW + 6), h: total + 4 },
    };
  }

  private styleText(t: Text, size: number, spacing: number) {
    t.style = {
      fontFamily: NOTE_FAMILY,
      fontSize: size,
      fontWeight: '400',
      letterSpacing: spacing,
      fill: this.inkColor,
      // 低透明度的柔光取代實心描邊：不會填滿筆劃之間的空隙
      dropShadow: { color: this.haloColor, alpha: 0.55, blur: 1.6, distance: 0, angle: 0 },
      padding: 3,
    };
  }

  /** 每次約 50 ms 呼叫一次：重繪霧與水珠並上傳貼圖；留言隨霧氣重新凝結而淡去 */
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

    const clarity = this.noteClarity(now);
    if (this.note && clarity > 0) {
      // 字底下的霧稍微濃一點：不論窗外是晨光還是夜景，字的底色都差不多
      const { x, y, w, h } = this.note.box;
      ctx.globalAlpha = 0.3 * clarity;
      ctx.fillStyle = this.fogColor;
      ctx.fillRect(x + 1, y, w - 2, h);
      ctx.fillRect(x, y + 1, w, h - 2);
      ctx.globalAlpha = 1;
    }
    // 留言以 6 階量化淡出，維持像素遊戲的節奏感
    this.textView.alpha = Math.ceil(clarity * 6) / 6;
    if (this.note && clarity <= 0) this.clearNote();

    // 水痕的地方把霧擦掉
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(this.trails.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

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

  /** 1 = 剛寫下、清清楚楚；0 = 被霧完全蓋住 */
  private noteClarity(now: number) {
    const note = this.note;
    if (!note) return 0;
    const age = now - note.createdAt;
    const fadeSpan = Math.max(1, note.ttlMs - CLEAR_SEC * 1000);
    const k = Math.min(1, Math.max(0, (age - CLEAR_SEC * 1000) / fadeSpan));
    return 1 - k * k * (3 - 2 * k);
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
