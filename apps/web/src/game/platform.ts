// 月台場景：等車、坐長椅、看列車進站開門，點車門上車（docs/PRD.md 第 15 章）
// 月台只在本機模擬：候車的人是 NPC；上車時才向伺服器要座位。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { CARS, LINES, npcIdentity, stationIsUnderground, type LineId, type Mode } from '@cc/shared';
import { mixer } from '../audio/AmbientMixer';
import { actions, devParams, store, type PlatformPhase } from '../store';
import { Actor, type Label } from './actor';
import type { CharacterFrames, View } from './characters';
import { DOORS, H, W } from './layout';
import { hexToNum, PALETTES } from './palette';
import {
  BENCH_H, BENCH_SEAT_DX, BENCH_TOP, BENCH_W, BENCHES, buildPlatformArt, CAR_GAP, CAR_W, CEIL_H, FLOOR_TOP,
  GATE_TOP, PSD_BOTTOM, PSD_TOP, TRAIN_DOOR_H, TRAIN_DOOR_TOP, TRAIN_TOP, type PlatformArt,
} from './platformArt';
import type { Scene } from './scene';

/** 角色站立時腳底在 cell 內的 y */
const FEET = 62;
/** 走動的走道、排隊的位置、走進車門的位置（cell 左上角 y） */
const LANE_Y = 210;
const QUEUE_Y = 178;
const DOOR_Y = 146;
const SIT_Y = BENCH_TOP - 46;
const PILLARS = [136, 490] as const;
const PILLAR_W = 14;
/** 停妥時對準畫面的那一節（0 起算） */
const DOCK_CAR = 1;
const ARRIVE_SEC = 5;
const CLOSE_SEC = 1.4;
const LEAVE_SEC = 5;
const DOOR_OPEN_SEC = 1;
const ME = 'me';

type Role = 'queue' | 'bench' | 'walker' | 'boarding' | 'leaving';
interface Npc { actor: Actor; role: Role; spot: string | null }

export interface PlatformHooks {
  /** 走進車門了：上車。回傳 false 代表沒上成（連線失敗等），玩家回到月台 */
  board(toward: number): Promise<boolean>;
}

export interface PlatformStart {
  lineId: LineId;
  station: number;
  /** 剛下車：列車還停著、門開著，剩下幾毫秒關門；toward 是那班車的方向 */
  docked?: { leftMs: number; toward: number; fromDoor: number };
}

const doorCenter = (i: number) => DOORS[i].x + DOORS[i].w / 2;
const cellX = (centerX: number) => Math.round(centerX - 32);
const benchSeats = BENCHES.flatMap((b, bi) => BENCH_SEAT_DX.map((dx, si) => ({ id: `b${bi}${si}`, x: b.x + dx })));
const queueSpots = DOORS.flatMap((_, i) => [
  { id: `q${i}L`, x: doorCenter(i) - 30 },
  { id: `q${i}R`, x: doorCenter(i) + 26 },
]);

export class PlatformScene implements Scene {
  readonly kind = 'platform';
  readonly world = new Container();
  private line;
  private underground: boolean;
  private ceiling = new Sprite();
  private back = new Sprite();
  private train = new Container();
  private cars: { body: Sprite; leaves: Sprite[] }[] = [];
  private psd = new Sprite();
  private psdLeaves: Sprite[] = [];
  private lights = new Graphics();
  private floor = new Sprite();
  private people = new Container();
  private benches: Sprite[] = [];
  private pillars = new Graphics();
  private art: PlatformArt | null = null;
  private mode: Mode = 'night';
  private frames: CharacterFrames | undefined;

  private phase: PlatformPhase = 'away';
  private phaseT = 0;
  private phaseLen = 6;
  private toward: number;
  private trainX = 3000;
  private doors = 0;
  private me: Actor;
  private myRole: 'stand' | 'sit' | 'walk' | 'boarding' = 'walk';
  private mySeat: string | null = null;
  private npcs: Npc[] = [];
  private spawnTimer = 3;
  private lightAcc = 0;
  private time = 0;
  private boarding = false;
  /** 正走向開著的車門 */
  private walkingToDoor = false;
  /** 延遲動作：跟著場景的時間走，場景收掉就不會再執行 */
  private timers: { at: number; fn: () => void }[] = [];
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private start: PlatformStart, private hooks: PlatformHooks) {
    this.line = LINES[start.lineId];
    this.underground = stationIsUnderground(this.line, start.station);
    this.toward = start.docked?.toward ?? this.randomToward();

    // ── 圖層（由後到前）──
    this.back.y = CEIL_H;
    this.train.y = TRAIN_TOP;
    for (let k = 0; k < CARS; k++) {
      const car = new Container();
      const body = new Sprite();
      car.addChild(body);
      const leaves: Sprite[] = [];
      for (const d of DOORS) {
        const mask = new Graphics().rect(d.x + 2, TRAIN_DOOR_TOP, d.w - 4, TRAIN_DOOR_H).fill(0xffffff);
        const box = new Container();
        box.mask = mask;
        const pair = [new Sprite(), new Sprite()];
        pair.forEach(s => (s.y = TRAIN_DOOR_TOP));
        box.addChild(...pair);
        car.addChild(mask, box);
        leaves.push(...pair);
      }
      this.train.addChild(car);
      this.cars.push({ body, leaves });
    }
    this.psd.y = CEIL_H;
    const psdLeafLayer = new Container();
    const leafTop = this.underground ? PSD_TOP + 16 : GATE_TOP;
    for (const d of DOORS) {
      const mask = new Graphics().rect(d.x + 1, leafTop, d.w - 2, PSD_BOTTOM - leafTop).fill(0xffffff);
      const box = new Container();
      box.mask = mask;
      const pair = [new Sprite(), new Sprite()];
      pair.forEach(s => (s.y = leafTop));
      box.addChild(...pair);
      psdLeafLayer.addChild(mask, box);
      this.psdLeaves.push(...pair);
    }
    this.floor.y = PSD_BOTTOM;
    this.people.sortableChildren = true;
    for (const b of BENCHES) {
      const s = new Sprite();
      s.position.set(b.x, BENCH_TOP);
      s.zIndex = BENCH_TOP + BENCH_H;
      this.benches.push(s);
      this.people.addChild(s);
    }
    this.pillars.zIndex = FLOOR_TOP + 14;
    this.people.addChild(this.pillars);
    this.world.addChild(this.back, this.train, this.psd, psdLeafLayer, this.ceiling, this.floor, this.lights, this.people);

    // ── 自己 ──
    const { name, gender, avatar } = store.getState();
    const docked = start.docked;
    if (docked) {
      // 剛從這班車下來：從車門走出來
      const dx = cellX(doorCenter(docked.fromDoor));
      this.me = new Actor(ME, { name, gender, avatar }, 'stand', 'front', dx, DOOR_Y);
      this.me.walkTo([{ x: dx, y: LANE_Y + 6 }], 'front', () => this.standStill());
      this.setPhase('open', Math.max(2.5, docked.leftMs / 1000));
      this.trainX = 0;
      this.doors = 1;
    } else {
      // 從閘門走下來
      this.me = new Actor(ME, { name, gender, avatar }, 'walk', 'back', -60, LANE_Y);
      this.me.walkTo([{ x: 96, y: LANE_Y }], 'back', () => this.standStill());
      this.setPhase('away', 6);
    }
    this.people.addChild(this.me.sprite);

    // ── 一開始就有人在等車 ──
    const sitters = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < sitters; i++) {
      const seat = this.freeBench();
      if (seat) this.addNpc(seat.x, SIT_Y, 'bench', seat.id, 'idle');
    }
    const queuers = docked ? 0 : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < queuers; i++) {
      const q = this.freeQueue();
      if (q) this.addNpc(q.x, QUEUE_Y, 'queue', q.id, 'stand');
    }

    mixer.setSegment(this.underground ? 'underground' : 'elevated');
    store.setState({ scene: 'platform' });
    this.publish();
  }

  private randomToward() {
    const n = this.line.stations.length;
    if (this.start.station === 0) return n - 1;
    if (this.start.station === n - 1) return 0;
    return Math.random() < 0.5 ? 0 : n - 1;
  }

  // ── 列車 ──

  private setPhase(phase: PlatformPhase, sec: number) {
    this.phase = phase;
    this.phaseT = 0;
    this.phaseLen = sec;
    this.publish();
    const terminal = this.line.stations[this.toward];
    if (phase === 'arriving') actions.say('列車進站，請站在黃線後方。｜Train arriving. Please stand behind the yellow line.');
    if (phase === 'open') {
      if (!this.start.docked || this.time > 0) actions.say(`往${terminal.zh}的列車到了。先下後上，點車門上車。｜Train to ${terminal.en}. Tap a door to board.`);
      this.npcsAtOpen();
    }
    if (phase === 'closing') {
      mixer.playDoorChime();
      if (this.myRole !== 'boarding' && this.me.walking && this.walkingToDoor) {
        this.walkingToDoor = false;
        this.me.stop();
        actions.toast('車門關了，下一班車很快就來。');
      }
    }
  }

  private publish() {
    store.setState({
      platform: { station: this.start.station, phase: this.phase, at: Date.now() + (this.phaseLen - this.phaseT) * 1000, toward: this.toward },
    });
  }

  private advance() {
    switch (this.phase) {
      case 'away': return this.setPhase('arriving', ARRIVE_SEC);
      case 'arriving': return this.setPhase('open', devParams.dwellSec);
      case 'open':
        // 自己正要上車時，等伺服器回覆再關門
        if (this.boarding || this.walkingToDoor) return;
        return this.setPhase('closing', CLOSE_SEC);
      case 'closing': return this.setPhase('leaving', LEAVE_SEC);
      case 'leaving':
        this.toward = this.randomToward();
        return this.setPhase('away', 12 + Math.random() * 6);
    }
  }

  // ── NPC ──

  private addNpc(x: number, y: number, role: Role, spot: string | null, anim: 'idle' | 'stand' | 'walk', view: View = 'back') {
    const who = npcIdentity([this.me?.look.name, ...this.npcs.map(n => n.actor.look.name)].filter(Boolean) as string[]);
    const actor = new Actor(`npc${Math.random().toString(36).slice(2, 8)}`, who, anim, view, cellX(x), y);
    this.people.addChild(actor.sprite);
    const npc: Npc = { actor, role, spot };
    this.npcs.push(npc);
    return npc;
  }

  private takenSpots() {
    const set = new Set(this.npcs.map(n => n.spot).filter(Boolean) as string[]);
    if (this.mySeat) set.add(this.mySeat);
    return set;
  }

  private freeBench() {
    const taken = this.takenSpots();
    const free = benchSeats.filter(s => !taken.has(s.id));
    return free[Math.floor(Math.random() * free.length)];
  }

  private freeQueue() {
    const taken = this.takenSpots();
    const free = queueSpots.filter(s => !taken.has(s.id));
    return free[Math.floor(Math.random() * free.length)];
  }

  /** 開門：先下車的人走出來，排隊的人走進去 */
  private npcsAtOpen() {
    const out = Math.floor(Math.random() * 3);
    for (let i = 0; i < out; i++) {
      const door = Math.floor(Math.random() * DOORS.length);
      const npc = this.addNpc(doorCenter(door), DOOR_Y, 'leaving', null, 'stand', 'front');
      const x = npc.actor.sprite.x;
      this.later(0.3 + i * 0.7, () => {
        npc.actor.walkTo([{ x, y: LANE_Y + 10 }, { x: x < W / 2 ? -80 : W + 20, y: LANE_Y + 10 }], 'front', () => npc.actor.fadeOut());
      });
    }
    this.npcs.forEach((n, i) => {
      const goes = n.role === 'queue' || (n.role === 'bench' && Math.random() < 0.3);
      if (!goes) return;
      this.later(1.6 + out * 0.7 + i * 0.5, () => {
        if (this.phase !== 'open' || n.role === 'leaving' || n.actor.fadingOut) return;
        const door = DOORS.reduce((best, _, d) => (Math.abs(doorCenter(d) - n.actor.sprite.x - 32) < Math.abs(doorCenter(best) - n.actor.sprite.x - 32) ? d : best), 0);
        const dx = cellX(doorCenter(door));
        const from = n.role === 'bench' ? [{ x: n.actor.sprite.x, y: LANE_Y }] : [];
        if (n.role === 'bench') n.actor.placeAt(n.actor.sprite.x, LANE_Y);
        n.role = 'boarding';
        n.spot = null;
        n.actor.walkTo([...from, { x: dx, y: QUEUE_Y }, { x: dx, y: DOOR_Y }], 'back', () => n.actor.fadeOut());
      });
    });
  }

  private later(sec: number, fn: () => void) {
    this.timers.push({ at: this.time + sec, fn });
  }

  /** 列車離開後陸續有人走進月台 */
  private spawnWalker() {
    if (this.npcs.filter(n => n.role !== 'leaving' && n.role !== 'boarding').length >= 5) return;
    const fromLeft = Math.random() < 0.5;
    const sit = Math.random() < 0.4 ? this.freeBench() : undefined;
    const target = sit ?? this.freeQueue();
    if (!target) return;
    const npc = this.addNpc(fromLeft ? -30 : W + 30, LANE_Y, 'walker', target.id, 'walk');
    const tx = cellX(target.x);
    if (sit) {
      npc.actor.walkTo([{ x: tx, y: LANE_Y }], 'back', () => {
        npc.actor.placeAt(tx, SIT_Y);
        npc.actor.setAnim('idle', 'back');
        npc.role = 'bench';
      });
    } else {
      npc.actor.walkTo([{ x: tx, y: LANE_Y }, { x: tx, y: QUEUE_Y }], 'back', () => {
        npc.actor.setAnim('stand', 'back');
        npc.role = 'queue';
      });
    }
  }

  // ── 自己 ──

  private standStill() {
    this.myRole = 'stand';
    this.me.setAnim('stand', 'back');
  }

  /** 從長椅站起來，回到走道上 */
  private leaveSeat() {
    if (this.myRole !== 'sit') return;
    this.mySeat = null;
    this.me.placeAt(this.me.sprite.x, LANE_Y);
  }

  tap(x: number, y: number) {
    if (this.myRole === 'boarding') return;
    // 點車門：開著就上車
    const door = DOORS.findIndex(d => x >= d.x && x < d.x + d.w);
    if (door >= 0 && y >= PSD_TOP && y < FLOOR_TOP + 30) {
      if (this.phase === 'open' && (this.phaseLen - this.phaseT > 2 || this.boarding)) return this.walkIntoDoor(door);
      actions.toast(this.phase === 'away' || this.phase === 'leaving' ? '列車還沒來，坐一下等等吧。' : this.phase === 'arriving' ? '列車進站中，等車門打開。' : '車門要關了，等下一班吧。');
      return;
    }
    // 點長椅：坐下
    const bench = BENCHES.findIndex(b => x >= b.x && x < b.x + BENCH_W);
    if (bench >= 0 && y >= BENCH_TOP - 40 && y < BENCH_TOP + BENCH_H + 6) {
      const taken = this.takenSpots();
      const seat = benchSeats
        .filter(s => s.id.startsWith(`b${bench}`) && (!taken.has(s.id) || s.id === this.mySeat))
        .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
      if (!seat) return actions.toast('長椅坐滿了。');
      if (seat.id === this.mySeat) return;
      this.leaveSeat();
      this.walkingToDoor = false;
      this.myRole = 'walk';
      this.mySeat = seat.id;
      const sx = cellX(seat.x);
      this.me.walkTo([{ x: this.me.sprite.x, y: LANE_Y }, { x: sx, y: LANE_Y }], 'back', () => {
        this.me.placeAt(sx, SIT_Y);
        this.me.setAnim('idle', 'back');
        this.myRole = 'sit';
      });
      return;
    }
    // 點地板：走過去站著
    if (y >= FLOOR_TOP - 10 && y < H) {
      this.leaveSeat();
      this.walkingToDoor = false;
      this.myRole = 'walk';
      const tx = cellX(Math.max(20, Math.min(W - 20, x)));
      const ty = Math.max(QUEUE_Y, Math.min(LANE_Y + 20, Math.round(y - FEET + 4)));
      this.me.walkTo([{ x: this.me.sprite.x, y: Math.max(this.me.sprite.y, QUEUE_Y) }, { x: tx, y: ty }], 'back', () => this.standStill());
    }
  }

  private walkIntoDoor(door: number) {
    this.leaveSeat();
    this.myRole = 'walk';
    this.walkingToDoor = true;
    const dx = cellX(doorCenter(door));
    this.me.walkTo([{ x: this.me.sprite.x, y: Math.max(this.me.sprite.y, QUEUE_Y) }, { x: dx, y: QUEUE_Y }, { x: dx, y: DOOR_Y }], 'back', () => {
      this.walkingToDoor = false;
      this.myRole = 'boarding';
      this.boarding = true;
      this.me.fadeOut();
      void this.hooks.board(this.toward).then(ok => {
        if (ok) return;
        // 沒上成：回到月台上
        this.boarding = false;
        this.me.fadeIn();
        this.me.walkTo([{ x: dx, y: LANE_Y }], 'front', () => this.standStill());
        this.myRole = 'walk';
        actions.toast('這班車沒搭上，等下一班吧。');
      });
    });
  }

  // ── 場景介面 ──

  focusX() {
    return this.me.sprite.x + 32;
  }

  labels(out: Label[]) {
    const push = (a: Actor, self: boolean) => {
      const { x, y } = a.headTop;
      out.push({ id: a.id, name: a.look.name, x, y, alpha: a.sprite.alpha, self });
    };
    this.npcs.forEach(n => push(n.actor, false));
    push(this.me, true);
  }

  colors(mode: Mode) {
    const pal = PALETTES[mode];
    return { top: pal.ceiling, edge: pal.ceilingLight, bottom: pal.platformTile, background: pal.platformWall };
  }

  setMode(mode: Mode, chars: CharacterFrames) {
    this.mode = mode;
    this.frames = chars;
    const pal = PALETTES[mode];
    const old = this.art;
    const art = buildPlatformArt(pal, mode === 'night', this.line, this.start.station, this.underground);
    this.art = art;
    this.ceiling.texture = art.ceiling;
    this.back.texture = art.back;
    this.psd.texture = art.psd;
    this.floor.texture = art.floor;
    this.cars.forEach(c => {
      c.body.texture = art.car;
      c.leaves.forEach((s, i) => (s.texture = art.carLeaves[i % 2]));
    });
    this.psdLeaves.forEach((s, i) => (s.texture = art.psdLeaves[i % 2]));
    this.benches.forEach(b => (b.texture = art.bench));
    this.drawPillars();
    if (old) requestAnimationFrame(() => artTextures(old).forEach(t => t.destroy(true)));
  }

  private drawPillars() {
    const pal = PALETTES[this.mode];
    const g = this.pillars;
    g.clear();
    for (const x of PILLARS) {
      g.rect(x, CEIL_H, PILLAR_W, FLOOR_TOP + 14 - CEIL_H).fill(hexToNum(pal.platformWall));
      g.rect(x, CEIL_H, 2, FLOOR_TOP + 14 - CEIL_H).fill(hexToNum(pal.wallHi));
      g.rect(x + PILLAR_W - 3, CEIL_H, 3, FLOOR_TOP + 14 - CEIL_H).fill(hexToNum(pal.wallShade));
      g.rect(x - 2, FLOOR_TOP + 10, PILLAR_W + 4, 4).fill(hexToNum(pal.metalLo));
      g.rect(x + 2, 120, PILLAR_W - 4, 18).fill(hexToNum(this.line.color));
    }
  }

  /** 列車進站燈號：進站與開門時月台門上方的燈閃爍，地面邊緣的燈條一起亮 */
  private drawLights() {
    const pal = PALETTES[this.mode];
    const g = this.lights;
    g.clear();
    const active = this.phase === 'arriving' || this.phase === 'open' || this.phase === 'closing';
    const blink = Math.floor(this.time * (this.phase === 'closing' ? 6 : 2.5)) % 2 === 0;
    const on = hexToNum(this.phase === 'closing' ? pal.warning : pal.ledOn);
    const off = hexToNum(pal.ledDim);
    const top = this.underground ? PSD_TOP + 2 : GATE_TOP - 6;
    for (const d of DOORS) {
      for (const lx of [d.x + 2, d.x + d.w - 6]) {
        g.rect(lx, top, 4, 4).fill(active && blink ? on : off);
      }
    }
    if (active) {
      for (let x = 4; x < W; x += 24) g.rect(x, PSD_BOTTOM + 1, 10, 2).fill({ color: on, alpha: blink ? 0.9 : 0.45 });
    }
  }

  update(dt: number) {
    const rm = this.reducedMotion.matches;
    this.time += dt;
    this.phaseT += dt;
    if (this.phaseT >= this.phaseLen) this.advance();
    const due = this.timers.filter(t => t.at <= this.time);
    if (due.length) {
      this.timers = this.timers.filter(t => t.at > this.time);
      due.forEach(t => t.fn());
    }

    // 列車位置：進站減速、出站加速
    const t = Math.min(1, this.phaseT / this.phaseLen);
    if (this.phase === 'arriving') this.trainX = 1500 * (1 - t) ** 2;
    else if (this.phase === 'leaving') this.trainX = -2900 * t * t;
    else if (this.phase === 'away') this.trainX = 3000;
    else this.trainX = 0;
    this.cars.forEach((c, k) => {
      const car = c.body.parent!;
      car.x = Math.round(this.trainX + (k - DOCK_CAR) * (CAR_W + CAR_GAP));
      car.visible = car.x < W && car.x + CAR_W > 0;
    });

    // 車門與月台門一起開關
    const wantOpen = this.phase === 'open' && this.phaseT > 0.4;
    this.doors = Math.max(0, Math.min(1, this.doors + (wantOpen ? 1 : -1) * dt / (wantOpen ? DOOR_OPEN_SEC : CLOSE_SEC * 0.8)));
    const k = rm ? (wantOpen ? 1 : 0) : this.doors * this.doors * (3 - 2 * this.doors);
    const slide = Math.round(k * 34);
    DOORS.forEach((d, i) => {
      for (const c of this.cars) {
        c.leaves[i * 2].x = d.x + 2 - slide;
        c.leaves[i * 2 + 1].x = d.x + d.w / 2 + slide;
      }
      this.psdLeaves[i * 2].x = d.x + 1 - slide;
      this.psdLeaves[i * 2 + 1].x = d.x + d.w / 2 + slide;
    });

    this.lightAcc += dt;
    if (this.lightAcc >= 0.1) {
      this.lightAcc = 0;
      this.drawLights();
    }

    if (this.phase === 'away' || this.phase === 'leaving') {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 4 + Math.random() * 5;
        this.spawnWalker();
      }
    }

    // 角色：依腳底高度排前後
    const all = [...this.npcs.map(n => n.actor), this.me];
    for (const a of all) {
      a.update(dt, this.frames);
      const sitting = a.anim !== 'stand' && a.anim !== 'walk';
      a.sprite.zIndex = sitting ? BENCH_TOP + BENCH_H - 2 : a.sprite.y + FEET;
    }
    const gone = this.npcs.filter(n => n.actor.gone);
    if (gone.length) {
      gone.forEach(n => n.actor.sprite.destroy());
      this.npcs = this.npcs.filter(n => !gone.includes(n));
    }
  }

  dispose() {
    const art = this.art;
    requestAnimationFrame(() => {
      this.world.destroy({ children: true });
      if (art) artTextures(art).forEach(t => t.destroy(true));
    });
  }

  /** 開發用 */
  debug() {
    return {
      phase: this.phase, left: +(this.phaseLen - this.phaseT).toFixed(1), doors: +this.doors.toFixed(2),
      me: { x: this.me.sprite.x, y: this.me.sprite.y, role: this.myRole, seat: this.mySeat },
      npcs: this.npcs.map(n => ({ name: n.actor.look.name, role: n.role, spot: n.spot })),
    };
  }
}

function artTextures(a: PlatformArt): Texture[] {
  return [a.ceiling, a.back, a.car, ...a.carLeaves, a.psd, ...a.psdLeaves, a.floor, a.bench];
}
