// 一個角色：負責逐幀動畫、走路與淡入淡出。車廂乘客與月台上的人都用它。
import { Sprite } from 'pixi.js';
import type { AvatarId, Gender } from '@cc/shared';
import { FRAME_MS, FRAMES, type Anim, type CharacterFrames, type View } from './characters';

export interface Look {
  name: string;
  gender: Gender;
  avatar: AvatarId;
}

/** 名字標籤：world 座標，由 Stage 換算成螢幕位置 */
export interface Label {
  id: string;
  name: string;
  x: number;
  y: number;
  alpha: number;
  self: boolean;
  /** 互動時頭上浮起的字（嗶！、♪、📜） */
  pop?: boolean;
  /** 通道門的指示牌：靠左或靠右對齊、可以點 */
  sign?: { align: 'left' | 'right'; action: () => void };
}

/** 走路速度（px/s） */
const WALK_SPEED = 72;

/** 每個動作的播放序列（atlas 內的 frame 索引）：閱讀大部分時間停在呼吸幀，偶爾翻頁 */
function sequence(anim: Anim, step: number): number {
  if (anim === 'read') {
    const s = step % 40;
    return s === 39 ? 2 : s % 2;
  }
  return step % FRAMES[anim].length;
}

export class Actor {
  readonly sprite = new Sprite();
  private step = Math.floor(Math.random() * 8);
  private stepTimer = Math.random() * 600;
  /** 各角色隨機相位，避免全場同步呼吸 */
  private phase = Math.random();
  private path: { x: number; y: number }[] = [];
  private then: (() => void) | undefined;
  /** 1 淡入、-1 淡出 */
  private fade: 1 | -1 = 1;
  /** 走路時的浮點位置；畫面上一律取整數像素，放大後才不會糊 */
  private fx = 0;
  private fy = 0;

  constructor(
    readonly id: string,
    public look: Look,
    public anim: Anim,
    public view: View,
    x: number,
    y: number,
    fadeIn = true,
  ) {
    this.placeAt(x, y);
    this.sprite.alpha = fadeIn ? 0 : 1;
  }

  get walking() {
    return this.path.length > 0;
  }

  get gone() {
    return this.fade === -1 && this.sprite.alpha <= 0;
  }

  get fadingOut() {
    return this.fade === -1;
  }

  /** 名字標籤的錨點：頭頂正上方 */
  get headTop() {
    const top = this.anim === 'stand' || this.anim === 'walk' ? 1 : this.anim === 'hang' ? 5 : 7;
    return { x: this.sprite.x + 32, y: this.sprite.y + top };
  }

  setAnim(anim: Anim, view: View = this.view) {
    if (anim === this.anim && view === this.view) return;
    this.anim = anim;
    this.view = view;
    this.step = 0;
    this.stepTimer = 0;
  }

  placeAt(x: number, y: number) {
    this.fx = x;
    this.fy = y;
    this.sprite.position.set(Math.round(x), Math.round(y));
  }

  /** 依序走過每個點（cell 左上角座標），到達後站好並呼叫 then */
  walkTo(points: { x: number; y: number }[], view: View, then?: () => void) {
    this.path = points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    this.then = then;
    this.setAnim('walk', view);
  }

  stop() {
    this.path = [];
    this.then = undefined;
    if (this.anim === 'walk') this.setAnim('stand');
  }

  fadeOut() {
    this.fade = -1;
  }

  fadeIn() {
    this.fade = 1;
  }

  update(dt: number, frames: CharacterFrames | undefined) {
    this.sprite.alpha = Math.max(0, Math.min(1, this.sprite.alpha + this.fade * dt * 1.6));

    const target = this.path[0];
    if (target) {
      const dx = target.x - this.fx;
      const dy = target.y - this.fy;
      const dist = Math.hypot(dx, dy);
      const stepPx = WALK_SPEED * dt;
      if (dist <= stepPx) {
        this.placeAt(target.x, target.y);
        this.path.shift();
        if (this.path.length === 0) {
          this.setAnim('stand');
          const then = this.then;
          this.then = undefined;
          then?.();
        }
      } else {
        this.placeAt(this.fx + (dx / dist) * stepPx, this.fy + (dy / dist) * stepPx);
      }
    }

    this.stepTimer += dt * 1000;
    if (this.stepTimer >= FRAME_MS[this.anim] * (0.9 + this.phase * 0.2)) {
      this.stepTimer = 0;
      this.step++;
    }
    if (frames) {
      this.sprite.texture = frames[this.look.avatar][this.look.gender][this.view][FRAMES[this.anim][sequence(this.anim, this.step)]];
    }
  }
}
