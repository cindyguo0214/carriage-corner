// 車窗外的視差景觀：天空 → 遠山 → 地標剪影 → 近景 → 隧道／月台 → 雨絲
import { Container, Particle, ParticleContainer, Sprite, TilingSprite } from 'pixi.js';
import { SCENE_H, SCENE_Y, W } from './layout';
import { midKindFor, PLATFORM_W, TUNNEL_LIGHT_SPACING, type MidKind, type SceneryArt } from './sceneryArt';
import { NEAR_PX, type Train } from './train';

const FAR_K = 0.04;
const MID_K = 0.18;
/** 月台停妥時的位置：讓長條月台置中於車廂 */
const PLATFORM_DOCK_X = -(PLATFORM_W - W) / 2;
const RAIN_COUNT = 110;

export class Scenery {
  readonly view = new Container();
  private sky = new Sprite();
  private far = new TilingSprite({ width: W, height: SCENE_H });
  private mid = new TilingSprite({ width: W, height: SCENE_H });
  private near = new TilingSprite({ width: W, height: SCENE_H });
  private tunnel = new TilingSprite({ width: W, height: SCENE_H });
  private platformFrom = new Sprite();
  private platformTo = new Sprite();
  private rain = new ParticleContainer({ dynamicProperties: { position: true, color: true, rotation: false, uvs: true } });
  private drops: Particle[] = [];
  private art!: SceneryArt;
  private midKind: MidKind = 'skyline';
  private acc = { far: 0, mid: 0, near: 0 };
  private tunnelAlpha = 1;
  /** 出隧道瞬間的光線（0..1），由 Lighting 讀取 */
  portalFlash = 0;
  /** 隧道燈在螢幕上的 x 位置，供 Lighting 投射掃光 */
  tunnelLightXs: number[] = [];

  constructor() {
    this.view.y = SCENE_Y;
    this.view.addChild(this.sky, this.far, this.mid, this.near, this.tunnel, this.platformFrom, this.platformTo, this.rain);
  }

  setArt(art: SceneryArt, train: Train) {
    this.art = art;
    this.sky.texture = art.sky;
    this.far.texture = art.far;
    this.tunnel.texture = art.tunnel;
    this.midKind = midKindFor(train.landmarks);
    this.applyNearMid();
    this.rain.removeParticles();
    // ParticleContainer 會記住第一次用的貼圖；晨／夜換美術時舊貼圖會被釋放，必須指向新的
    this.rain.texture = art.rain[0];
    this.drops = Array.from({ length: RAIN_COUNT }, () =>
      new Particle({ texture: art.rain[0], x: Math.random() * W, y: Math.random() * SCENE_H }),
    );
    this.rain.addParticle(...this.drops);
    this.tunnelAlpha = train.inTunnel ? 1 : 0;
  }

  /** 發車時依新區段的地標換上對應的剪影 */
  onDepart(train: Train) {
    this.midKind = midKindFor(train.landmarks);
    this.applyNearMid();
  }

  update(dt: number, train: Train, raining: boolean, reducedMotion: boolean) {
    const v = train.speed * NEAR_PX * dt;
    this.acc.far += v * FAR_K;
    this.acc.mid += v * MID_K;
    this.acc.near += v;
    this.far.tilePosition.x = -Math.round(this.acc.far);
    this.mid.tilePosition.x = -Math.round(this.acc.mid);
    this.near.tilePosition.x = -Math.round(this.acc.near);
    this.tunnel.tilePosition.x = -Math.round(this.acc.near);

    // 隧道 ⇄ 戶外：0.5 秒淡換；出隧道時給 Lighting 一道光
    const target = train.inTunnel ? 1 : 0;
    if (this.tunnelAlpha > 0.5 && target === 0) this.portalFlash = 1;
    this.tunnelAlpha += Math.sign(target - this.tunnelAlpha) * Math.min(Math.abs(target - this.tunnelAlpha), dt * 2);
    this.tunnel.alpha = this.tunnelAlpha;
    this.portalFlash = Math.max(0, this.portalFlash - dt * 1.2);

    this.tunnelLightXs.length = 0;
    if (this.tunnelAlpha > 0.05) {
      const offset = ((Math.round(this.acc.near) % TUNNEL_LIGHT_SPACING) + TUNNEL_LIGHT_SPACING) % TUNNEL_LIGHT_SPACING;
      for (let x = 64 - offset; x < W + TUNNEL_LIGHT_SPACING; x += TUNNEL_LIGHT_SPACING) this.tunnelLightXs.push(x);
    }

    this.updatePlatforms(train);
    this.updateRain(dt, train, raining && !train.inTunnel, reducedMotion);
  }

  private applyNearMid() {
    this.mid.texture = this.art.mid[this.midKind];
    this.near.texture = this.art.near[this.midKind === 'river' || this.midKind === 'lake' ? 'rail' : 'urban'];
  }

  private updatePlatforms(train: Train) {
    const place = (sprite: Sprite, station: number, x: number) => {
      sprite.texture = train.stationUnderground(station) ? this.art.platformUnder : this.art.platformOpen;
      sprite.x = Math.round(x);
      sprite.visible = sprite.x < W && sprite.x + PLATFORM_W > 0;
    };
    if (train.phase === 'dwell') {
      place(this.platformTo, train.to, PLATFORM_DOCK_X);
      this.platformFrom.visible = false;
    } else {
      place(this.platformFrom, train.from, PLATFORM_DOCK_X - train.dist);
      place(this.platformTo, train.to, PLATFORM_DOCK_X + (train.runDist - train.dist));
    }
  }

  private updateRain(dt: number, train: Train, visible: boolean, reducedMotion: boolean) {
    this.rain.visible = visible;
    if (!visible) return;
    const tilt = reducedMotion ? 0 : train.speed < 0.3 ? 0 : train.speed < 0.7 ? 1 : 2;
    const vx = reducedMotion ? 0 : 20 + train.speed * NEAR_PX * 0.7;
    const active = reducedMotion ? 40 : RAIN_COUNT;
    this.drops.forEach((d, i) => {
      d.alpha = i < active ? 1 : 0;
      d.texture = this.art.rain[tilt];
      d.y += 230 * dt;
      d.x -= vx * dt;
      if (d.y > SCENE_H) { d.y -= SCENE_H + 5; d.x = Math.random() * (W + 80); }
      if (d.x < -6) d.x += W + 12;
    });
  }
}
