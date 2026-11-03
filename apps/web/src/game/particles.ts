// 小粒子：咖啡熱氣、Zzz、微光光點、晨光浮塵（docs/PRD.md §2.4）
import { Container, Sprite, Texture } from 'pixi.js';
import { paint } from './paint';

type Kind = 'steam' | 'zzz' | 'spark';

interface P { sprite: Sprite; kind: Kind; vx: number; vy: number; life: number; age: number }

export class Particles {
  readonly view = new Container();
  private items: P[] = [];
  private textures: Record<Kind, Texture>;

  constructor() {
    this.textures = {
      steam: paint(2, 2, p => { p.rect(0, 0, 2, 2, '#ffffff', 0.7); p.px(1, 1, '#ffffff', 0.4); }),
      zzz: paint(4, 4, p => { p.rect(0, 0, 4, 1, '#ffffff'); p.px(2, 1, '#ffffff'); p.px(1, 2, '#ffffff'); p.rect(0, 3, 4, 1, '#ffffff'); }),
      spark: paint(1, 1, p => p.px(0, 0, '#ffffff')),
    };
  }

  emit(kind: Kind, x: number, y: number, tint: number) {
    if (this.items.length > 160) return;
    const sprite = new Sprite(this.textures[kind]);
    sprite.position.set(x, y);
    sprite.tint = tint;
    const p: P =
      kind === 'steam' ? { sprite, kind, vx: (Math.random() - 0.5) * 3, vy: -6, life: 2, age: 0 }
      : kind === 'zzz' ? { sprite, kind, vx: 3, vy: -5, life: 3, age: 0 }
      : { sprite, kind, vx: (Math.random() - 0.5) * 16, vy: -10 - Math.random() * 10, life: 1, age: 0 };
    this.items.push(p);
    this.view.addChild(sprite);
  }

  update(dt: number) {
    this.items = this.items.filter(p => {
      p.age += dt;
      if (p.age >= p.life) {
        p.sprite.destroy();
        return false;
      }
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      // 透明度也量化成 4 階
      p.sprite.alpha = Math.ceil((1 - p.age / p.life) * 4) / 4 * (p.kind === 'steam' ? 0.7 : 0.9);
      return true;
    });
  }
}
