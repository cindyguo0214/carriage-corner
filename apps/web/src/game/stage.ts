// 像素完美渲染管線：場景 → 640×360 RenderTexture → （直式再組成隨螢幕寬度的畫布）→ 整數倍放大（docs/PRD.md §6.4）
// 也負責：輸入換算、直式鏡頭、名字標籤、晨／夜與換場景時的交叉淡化。
import { Application, Container, Graphics, RenderTexture, Sprite, TextureStyle } from 'pixi.js';
import type { Mode } from '@cc/shared';
import { store } from '../store';
import type { Label } from './actor';
import { buildCharacterAtlas, type CharacterFrames } from './characters';
import { NameLabels } from './labels';
import { H, MIN_PW, PH, PORTRAIT_WORLD_Y, PW, W } from './layout';
import { hexToNum } from './palette';
import type { Scene } from './scene';

TextureStyle.defaultOptions.scaleMode = 'nearest';

export class Stage {
  readonly app = new Application();
  chars!: CharacterFrames;
  mode: Mode = store.getState().mode;
  private scene: Scene | null = null;
  private worldRT = RenderTexture.create({ width: W, height: H });
  private screenRT = RenderTexture.create({ width: PW, height: PH });
  private screen = new Container();
  private screenBg = new Graphics();
  private worldInScreen = new Sprite(this.worldRT);
  private display = new Sprite(this.worldRT);
  private fade = new Sprite();
  /** 螢幕解析度的疊層（車窗上的字）：跟著同一個鏡頭，裁在遊戲畫面範圍內 */
  private overlay = new Container();
  private overlayMask = new Graphics();
  private pixelScale = 1;
  private fadeT = 0;
  private fadeSec = 1.2;
  /** 換車廂的滑動：舊畫面往反方向滑出、新車廂從前進方向滑入 */
  private slideDir: -1 | 0 | 1 = 0;
  private slideT = 0;
  private baseX = 0;
  private labels!: NameLabels;
  private labelBuf: Label[] = [];
  private portrait = false;
  private camX = 0;
  private lastFocus = NaN;
  private cssScale = 1;
  /** 直式畫布寬度：隨螢幕調整，窄螢幕不裁切、寬一點的手機多看到一些 */
  private screenW = PW;
  private drag: { x: number; cam: number; moved: boolean } | null = null;

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      preference: 'webgl',
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      roundPixels: true,
      background: '#3A3846',
    });
    host.appendChild(this.app.canvas);
    this.labels = new NameLabels(host);
    this.chars = buildCharacterAtlas(this.mode);

    this.worldInScreen.y = PORTRAIT_WORLD_Y;
    this.screen.addChild(this.screenBg, this.worldInScreen);
    this.fade.visible = false;
    this.overlay.mask = this.overlayMask;
    this.app.stage.addChild(this.display, this.fade, this.overlay, this.overlayMask);
    this.app.renderer.on('resize', () => this.layout());
    this.bindInput();

    // 晨／夜切換：拍下目前畫面，換好美術後淡出
    store.subscribe((s, prev) => {
      if (s.mode === prev.mode) return;
      this.snapshotForFade(1.2);
      const old = this.chars;
      this.mode = s.mode;
      this.chars = buildCharacterAtlas(s.mode);
      this.scene?.setMode(s.mode, this.chars);
      this.applyColors();
      // 下一幀才釋放舊貼圖，避免本幀仍在使用；所有角色 frame 共用同一個 atlas source
      requestAnimationFrame(() => old.office.m.front[0].destroy(true));
    });

    this.app.ticker.add(ticker => this.tick(Math.min(0.1, ticker.deltaMS / 1000)));
  }

  get current() {
    return this.scene;
  }

  /** 換場景；transition 時交叉淡化（上下車、穿過貫通道） */
  show(scene: Scene, transition: boolean) {
    if (transition && this.scene) this.snapshotForFade(0.9);
    this.scene?.dispose();
    this.overlay.removeChildren();
    this.scene = scene;
    if (scene.overlay) this.overlay.addChild(scene.overlay);
    scene.setMode(this.mode, this.chars);
    scene.setPixelScale?.(this.pixelScale);
    this.applyColors();
    this.lastFocus = NaN;
    this.layout();
  }

  /** 同一場景內的大變動也淡化一下 */
  crossfade(sec = 0.9) {
    this.snapshotForFade(sec);
  }

  /** 穿過貫通道：dir=1 往後一節（畫面往左滑），-1 往前一節 */
  slide(dir: -1 | 1) {
    this.snapshotForFade(1);
    this.slideDir = dir;
    this.slideT = 0;
  }

  set maxFPS(fps: number) {
    this.app.ticker.maxFPS = fps;
  }

  private applyColors() {
    if (!this.scene) return;
    const c = this.scene.colors(this.mode);
    this.app.renderer.background.color = c.background;
    this.drawScreenBg();
  }

  private drawScreenBg() {
    if (!this.scene) return;
    const c = this.scene.colors(this.mode);
    const g = this.screenBg;
    g.clear();
    g.rect(0, 0, this.screenW, PORTRAIT_WORLD_Y).fill(hexToNum(c.top));
    g.rect(0, PORTRAIT_WORLD_Y - 6, this.screenW, 4).fill(hexToNum(c.edge));
    g.rect(0, PORTRAIT_WORLD_Y + H, this.screenW, PH - PORTRAIT_WORLD_Y - H).fill(hexToNum(c.bottom));
  }

  private clampCam(x: number) {
    return Math.max(0, Math.min(W - this.screenW, Math.round(x)));
  }

  private layout() {
    const cssW = this.app.screen.width;
    const cssH = this.app.screen.height;
    const dpr = this.app.renderer.resolution;
    this.portrait = cssH > cssW * 1.05;
    // 以實體像素計算最大整數倍率
    let scale: number;
    if (this.portrait) {
      scale = Math.max(1, Math.floor(Math.min((cssW * dpr) / MIN_PW, (cssH * dpr) / PH)));
      const width = Math.min(W, Math.floor((cssW * dpr) / scale));
      if (width !== this.screenW) {
        this.screenW = width;
        this.screenRT.resize(this.screenW, PH);
        this.drawScreenBg();
      }
    } else {
      scale = Math.max(1, Math.floor(Math.min((cssW * dpr) / W, (cssH * dpr) / H)));
    }
    const bw = this.portrait ? this.screenW : W;
    const bh = this.portrait ? PH : H;
    this.cssScale = scale / dpr;
    this.display.texture = this.portrait ? this.screenRT : this.worldRT;
    this.display.scale.set(this.cssScale);
    this.display.position.set(
      Math.round((cssW * dpr - bw * scale) / 2) / dpr,
      Math.round((cssH * dpr - bh * scale) / 2) / dpr,
    );
    this.baseX = this.display.x;
    this.fade.scale.copyFrom(this.display.scale);
    this.fade.position.copyFrom(this.display.position);
    this.lastFocus = NaN;
    this.overlayMask.clear().rect(this.display.x, this.display.y, bw * this.cssScale, bh * this.cssScale).fill(0xffffff);
    this.overlay.scale.set(this.cssScale);
    this.pixelScale = scale;
    this.scene?.setPixelScale?.(scale);
  }

  private snapshotForFade(sec: number) {
    const snap = RenderTexture.create({ width: this.portrait ? this.screenW : W, height: this.portrait ? PH : H });
    const tmp = new Sprite(this.display.texture);
    this.app.renderer.render({ container: tmp, target: snap });
    tmp.destroy();
    if (this.fade.visible) this.fade.texture.destroy(true);
    this.fade.texture = snap;
    this.fade.visible = true;
    this.fade.alpha = 1;
    this.fadeT = 1;
    this.fadeSec = sec;
  }

  // ── 輸入：點擊換算成 world 座標交給場景；直式可左右拖曳 ──
  private bindInput() {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', e => {
      this.drag = { x: e.clientX, cam: this.camX, moved: false };
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.drag || !this.portrait) return;
      const dx = (e.clientX - this.drag.x) / this.cssScale;
      if (Math.abs(dx) > 4) this.drag.moved = true;
      this.camX = this.clampCam(this.drag.cam - dx);
    });
    canvas.addEventListener('pointerup', e => {
      const wasDrag = this.drag?.moved;
      this.drag = null;
      if (wasDrag || !this.scene) return;
      const rect = canvas.getBoundingClientRect();
      const bx = (e.clientX - rect.left - this.display.x) / this.cssScale;
      const by = (e.clientY - rect.top - this.display.y) / this.cssScale;
      const p = this.portrait ? { x: bx + this.camX, y: by - PORTRAIT_WORLD_Y } : { x: bx, y: by };
      this.scene.tap(p.x, p.y, { x: e.clientX, y: e.clientY });
    });
  }

  private tick(dt: number) {
    const scene = this.scene;
    if (!scene) return;
    scene.update(dt, Date.now());

    // 直式鏡頭：焦點移動（換座位、在月台走動）時跟過去；使用者拖曳後維持在拖曳的位置
    if (this.portrait && !this.drag) {
      const focus = Math.round(scene.focusX());
      if (focus !== this.lastFocus) {
        const target = this.clampCam(focus - this.screenW / 2);
        const first = Number.isNaN(this.lastFocus);
        this.camX = first ? target : this.clampCam(this.camX + Math.sign(target - this.camX) * Math.max(1, Math.abs(target - this.camX) * 0.15));
        if (this.camX === target) this.lastFocus = focus;
      }
    }

    this.app.renderer.render({ container: scene.world, target: this.worldRT, clear: true });
    if (this.portrait) {
      this.worldInScreen.x = -this.camX;
      this.app.renderer.render({ container: this.screen, target: this.screenRT, clear: true });
    }
    if (this.slideDir !== 0) {
      this.slideT = Math.min(1, this.slideT + dt / 0.6);
      const k = this.slideT * this.slideT * (3 - 2 * this.slideT);
      const width = (this.portrait ? this.screenW : W) * this.cssScale;
      // 以實體像素對齊，滑動時也維持像素清晰
      const snap = (v: number) => Math.round(v * this.app.renderer.resolution) / this.app.renderer.resolution;
      this.fade.x = snap(this.baseX - this.slideDir * k * width);
      this.display.x = snap(this.baseX + this.slideDir * (1 - k) * width);
      if (this.slideT >= 1) {
        this.slideDir = 0;
        this.display.x = this.fade.x = this.baseX;
        this.fade.visible = false;
        this.fade.texture.destroy(true);
      }
    } else if (this.fade.visible) {
      this.fadeT -= dt / this.fadeSec;
      this.fade.alpha = Math.ceil(Math.max(0, this.fadeT) * 6) / 6;
      if (this.fadeT <= 0) {
        this.fade.visible = false;
        this.fade.texture.destroy(true);
      }
    }
    // 疊層跟著畫面（含直式鏡頭與換車廂的滑動）；交叉淡化時跟新畫面一起浮現
    this.overlay.x = this.display.x - (this.portrait ? this.camX * this.cssScale : 0);
    this.overlay.y = this.display.y + (this.portrait ? PORTRAIT_WORLD_Y * this.cssScale : 0);
    this.overlay.alpha = this.fade.visible && this.slideDir === 0 ? 1 - this.fade.alpha : 1;
    this.renderLabels(scene);
  }

  private renderLabels(scene: Scene) {
    this.labelBuf.length = 0;
    // 淡化或滑動期間舊畫面還蓋在上面，名字等新場景浮現後再出現
    if (this.slideDir === 0 && (!this.fade.visible || this.fade.alpha < 0.5)) scene.labels(this.labelBuf);
    const fadeIn = this.fade.visible ? 1 - this.fade.alpha : 1;
    const out = this.labelBuf.map(l => {
      const bx = this.portrait ? l.x - this.camX : l.x;
      const by = this.portrait ? l.y + PORTRAIT_WORLD_Y : l.y;
      return { ...l, alpha: l.alpha * fadeIn, sx: this.display.x + bx * this.cssScale, sy: this.display.y + by * this.cssScale - 2 };
    });
    this.labels.render(out);
  }
}
