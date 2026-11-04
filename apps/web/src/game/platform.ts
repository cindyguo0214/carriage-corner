// 月台場景：等車、坐長椅、看列車進站開門，點車門上車（docs/PRD.md 第 15 章）
// 候車的人是本機 NPC。連線時列車進站、開門、離站的時間跟伺服器的列車一致（第 19 章），
// 走進車門時坐進的就是那班停在這站的車；離線時在本機隨機排班。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { CARS, FORTUNES, LINES, npcIdentity, stationIsUnderground, type LineId, type Mode, type PlatformArrival } from '@cc/shared';
import { mixer } from '../audio/AmbientMixer';
import type { PlatformGlow } from '../gameBridge';
import { actions, devParams, store, type PlatformPhase } from '../store';
import { Actor, type Label } from './actor';
import type { CharacterFrames, View } from './characters';
import { DOORS, H, W } from './layout';
import { hexToNum, PALETTES } from './palette';
import { Particles } from './particles';
import {
  BENCH_H, BENCH_SEAT_DX, BENCH_TOP, BENCH_W, BENCHES, buildPlatformArt, CAR_GAP, CAR_W, CEIL_H, FLOOR_TOP,
  GATE_TOP, PSD_BOTTOM, PSD_TOP, TRAIN_DOOR_H, TRAIN_DOOR_TOP, TRAIN_TOP, XFER_SLOTS, XFER_TOP, XFER_W, xferStairs,
  type PlatformArt,
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
/** 月台互動時頭上浮起的字停留多久（秒） */
const POP_SEC = 1.6;
/** 遞幸運籤只挑吉利的（大吉／中吉） */
const LUCKY = FORTUNES.filter(f => f.grade !== '小吉');

type Role = 'queue' | 'bench' | 'walker' | 'boarding' | 'leaving';
interface Npc { actor: Actor; role: Role; spot: string | null }
interface Xfer { to: LineId; slot: (typeof XFER_SLOTS)[number]; sprite: Sprite }

export interface PlatformHooks {
  /** 走進車門了：上車（train 是伺服器那班車的編號）。回傳 false 代表沒上成（車開走了、連線失敗），玩家回到月台 */
  board(toward: number, train?: string): Promise<boolean>;
  /** 連線時：下一班停靠這站的列車（本機時鐘）。沒有這個 hook、或回傳 null 時改在本機隨機排班 */
  nextTrain?(): Promise<PlatformArrival | null>;
  /** 走下轉乘連通道了：換到另一條線的月台（docs/PRD.md §18.1） */
  transfer(to: LineId): void;
}

export interface PlatformStart {
  lineId: LineId;
  station: number;
  /** 剛下車：列車還停著、門開著，剩下幾毫秒關門；toward 是那班車的方向 */
  docked?: { leftMs: number; toward: number; fromDoor: number; train?: string };
  /** 從哪條線的轉乘連通道走上來 */
  via?: LineId;
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
  /** 轉乘連通道：可轉乘的路線與樓梯口貼圖 */
  private xfers: Xfer[] = [];
  private art: PlatformArt | null = null;
  private mode: Mode = 'night';
  private frames: CharacterFrames | undefined;

  private phase: PlatformPhase = 'away';
  /** 這個階段過了幾秒、何時結束：以真實時鐘計，切到背景再回來時會追上伺服器的列車 */
  private phaseT = 0;
  private phaseEnd = 0;
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
  /** 連線時這一班車的伺服器排班；null 代表還在問、或離線排班 */
  private schedule: PlatformArrival | null = null;
  private asking = false;
  private disposed = false;
  /** 正走向開著的車門 */
  private walkingToDoor = false;
  /** 延遲動作：跟著場景的時間走，場景收掉就不會再執行 */
  private timers: { at: number; fn: () => void }[] = [];
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  /** 輪盤互動的效果：頭上浮起的字、柔光圈、光點 */
  private pops: { id: string; actor: Actor; text: string; born: number }[] = [];
  private popSeq = 0;
  private glow = new Graphics();
  private glows: { actor: Actor; t: number }[] = [];
  private particles = new Particles();

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
    const xferLayer = new Container();
    (this.line.stations[start.station].transfer ?? []).slice(0, XFER_SLOTS.length).forEach((to, i) => {
      const sprite = new Sprite();
      sprite.position.set(XFER_SLOTS[i].x, XFER_TOP);
      xferLayer.addChild(sprite);
      this.xfers.push({ to, slot: XFER_SLOTS[i], sprite });
    });
    this.world.addChild(this.back, this.train, this.psd, psdLeafLayer, this.ceiling, this.floor, xferLayer, this.lights, this.glow, this.people, this.particles.view);

    // ── 自己 ──
    const { name, gender, avatar } = store.getState();
    const docked = start.docked;
    const via = this.xfers.find(x => x.to === start.via);
    if (via) {
      // 從轉乘連通道的樓梯走上來
      const sx = cellX(this.stairsCenter(via));
      this.me = new Actor(ME, { name, gender, avatar }, 'walk', 'back', sx, XFER_TOP - FEET + 40);
      this.me.walkTo([{ x: sx, y: LANE_Y + 4 }], 'back', () => this.standStill());
      this.awaitTrain(8);
    } else if (docked) {
      // 剛從這班車下來：從車門走出來
      const dx = cellX(doorCenter(docked.fromDoor));
      this.me = new Actor(ME, { name, gender, avatar }, 'stand', 'front', dx, DOOR_Y);
      this.me.walkTo([{ x: dx, y: LANE_Y + 6 }], 'front', () => this.standStill());
      this.setPhase('open', Math.max(2.5, docked.leftMs / 1000));
      if (docked.train) {
        const now = Date.now();
        this.schedule = { train: docked.train, arriveAt: now, departAt: now + docked.leftMs, dir: docked.toward === 0 ? -1 : 1 };
      }
      this.trainX = 0;
      this.doors = 1;
    } else {
      // 從閘門走下來
      this.me = new Actor(ME, { name, gender, avatar }, 'walk', 'back', -60, LANE_Y);
      this.me.walkTo([{ x: 96, y: LANE_Y }], 'back', () => this.standStill());
      this.awaitTrain(6);
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

  private stairsCenter(x: Xfer) {
    const st = xferStairs(x.slot.align === 'left');
    return x.slot.x + st.x + st.w / 2;
  }

  // ── 列車 ──

  /** 等下一班：連線時問伺服器，離線時 sec 秒後進站 */
  private awaitTrain(sec: number) {
    this.schedule = null;
    if (!this.hooks.nextTrain) return this.setPhase('away', sec);
    // 先放一段很長的等待，問到排班後再對齊
    this.setPhase('away', 60);
    void this.askNext(sec);
  }

  private async askNext(fallbackSec: number) {
    if (this.asking) return;
    this.asking = true;
    const next = await this.hooks.nextTrain!().catch(() => null);
    this.asking = false;
    if (this.disposed || this.phase !== 'away') return;
    if (!next) return this.setPhase('away', fallbackSec);
    this.schedule = next;
    this.toward = next.dir === 1 ? this.line.stations.length - 1 : 0;
    const now = Date.now();
    const toArrive = (next.arriveAt - now) / 1000;
    const toClose = (next.departAt - now) / 1000 - CLOSE_SEC;
    if (toArrive > ARRIVE_SEC) this.setPhase('away', toArrive - ARRIVE_SEC);
    else if (toArrive > 0.3) this.setPhase('arriving', toArrive);
    else if (toClose > 1) {
      // 那班車已經停在月台上：直接開門
      this.setPhase('open', toClose);
      this.trainX = 0;
    } else {
      this.schedule = null;
      this.setPhase('away', 2);
    }
  }

  /** 連線排班時，各階段的長度以伺服器時間為準 */
  private untilArrive() {
    return this.schedule ? Math.max(0.3, (this.schedule.arriveAt - Date.now()) / 1000) : ARRIVE_SEC;
  }

  private untilClose() {
    return this.schedule ? Math.max(1, (this.schedule.departAt - Date.now()) / 1000 - CLOSE_SEC) : devParams.dwellSec;
  }

  private setPhase(phase: PlatformPhase, sec: number) {
    this.phase = phase;
    this.phaseT = 0;
    this.phaseEnd = Date.now() + sec * 1000;
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
      case 'away':
        // 連線時還沒問到排班就繼續等
        if (this.hooks.nextTrain && !this.schedule) return void this.askNext(4);
        return this.setPhase('arriving', this.untilArrive());
      case 'arriving': return this.setPhase('open', this.untilClose());
      case 'open':
        // 自己正要上車時，等伺服器回覆再關門；離線時也等走向車門的人
        if (this.boarding || (this.walkingToDoor && !this.schedule)) return;
        return this.setPhase('closing', CLOSE_SEC);
      case 'closing': return this.setPhase('leaving', LEAVE_SEC);
      case 'leaving':
        this.toward = this.randomToward();
        return this.awaitTrain(12 + Math.random() * 6);
    }
  }

  // ── NPC ──

  private addNpc(x: number, y: number, role: Role, spot: string | null, anim: 'idle' | 'stand' | 'walk', view: View = 'back') {
    const who = npcIdentity([this.me?.look.name, ...this.npcs.map(n => n.actor.look.name)].filter(Boolean) as string[]);
    const actor = new Actor(`npc${Math.random().toString(36).slice(2, 8)}`, { ...who, npc: true }, anim, view, cellX(x), y);
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

  tap(x: number, y: number, client: { x: number; y: number }) {
    if (this.myRole === 'boarding') return;
    // 點其他候車乘客：展開月台輪盤（§23.2）
    const hit = this.npcs.find(
      n => n.role !== 'boarding' && n.role !== 'leaving' && n.actor.sprite.alpha > 0.5
        && x >= n.actor.sprite.x + 18 && x < n.actor.sprite.x + 46 && y >= n.actor.sprite.y + 4 && y < n.actor.sprite.y + 62,
    );
    if (hit) {
      actions.setUi({ glowMenu: { target: { npc: hit.actor.id }, name: hit.actor.look.name, state: 'idle', x: client.x, y: client.y } });
      return;
    }
    if (store.getState().ui.glowMenu) return actions.setUi({ glowMenu: null });
    // 點樓梯口或轉乘指示牌：走下連通道
    const xfer = this.xfers.find(t => x >= t.slot.x && x < t.slot.x + XFER_W && y >= XFER_TOP - 6);
    if (xfer) return this.walkToTransfer(xfer);
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

  private walkToTransfer(xfer: Xfer) {
    this.leaveSeat();
    this.walkingToDoor = false;
    this.myRole = 'walk';
    const sx = cellX(this.stairsCenter(xfer));
    this.me.walkTo([{ x: this.me.sprite.x, y: Math.max(this.me.sprite.y, LANE_Y) }, { x: sx, y: LANE_Y + 4 }, { x: sx, y: XFER_TOP - FEET + 40 }], 'front', () => {
      this.myRole = 'boarding';
      this.me.fadeOut();
      this.hooks.transfer(xfer.to);
    });
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
      void this.hooks.board(this.toward, this.schedule?.train).then(ok => {
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

  /** 月台輪盤的四個互動：只在本機演出（月台上的人都是候車中的 NPC） */
  greet(npcId: string, kind: PlatformGlow) {
    const npc = this.npcs.find(n => n.actor.id === npcId);
    if (!npc) return;
    const { actor } = npc;
    if (kind === 'hi') {
      mixer.playHi();
      this.popOn(actor, '👋');
    } else if (kind === 'beep') {
      mixer.playCardBeep();
      this.popOn(actor, '嗶！');
    } else if (kind === 'wave') {
      this.popOn(actor, '♪');
    } else {
      const f = LUCKY[Math.floor(Math.random() * LUCKY.length)];
      this.popOn(actor, `📜 ${f.grade}`);
      actions.toast(`你遞給${actor.look.name}一張籤：「${f.text}」（${f.grade}）`);
    }
    this.glows.push({ actor, t: 0 });
    const tint = hexToNum(PALETTES[this.mode].glow);
    for (let i = 0; i < (kind === 'wave' ? 10 : 6); i++) {
      this.particles.emit('spark', actor.sprite.x + 24 + Math.random() * 16, actor.sprite.y + 14, tint);
    }
  }

  private popOn(actor: Actor, text: string) {
    this.pops = this.pops.filter(p => p.actor !== actor);
    this.pops.push({ id: `pop${++this.popSeq}`, actor, text, born: this.time });
  }

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
    this.pops = this.pops.filter(p => this.time - p.born < POP_SEC && !p.actor.gone);
    for (const p of this.pops) {
      const k = (this.time - p.born) / POP_SEC;
      const { x, y } = p.actor.headTop;
      out.push({ id: p.id, name: p.text, x, y: y - 10 - Math.round(k * 10), alpha: k < 0.7 ? 1 : (1 - k) / 0.3, self: false, pop: true });
    }
    for (const x of this.xfers) {
      const to = LINES[x.to];
      const left = x.slot.align === 'left';
      out.push({
        id: `xfer-${x.to}`,
        name: left ? `❮ 往 ${to.zh} ${to.id}` : `往 ${to.zh} ${to.id} ❯`,
        x: left ? x.slot.x + 2 : x.slot.x + XFER_W - 2,
        y: XFER_TOP - 12,
        alpha: 1,
        self: false,
        sign: { align: x.slot.align, accent: to.color, action: () => this.myRole !== 'boarding' && this.walkToTransfer(x) },
      });
    }
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
    this.xfers.forEach((x, i) => (x.sprite.texture = art.transfers[i]));
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
    // 背景期間錯過的階段一次補上（暫停等待中的階段不會換，就停下來）
    for (let i = 0; i < 6 && Date.now() >= this.phaseEnd; i++) {
      const before = this.phase;
      this.advance();
      if (this.phase === before) break;
    }
    this.phaseT = this.phaseLen - Math.max(0, this.phaseEnd - Date.now()) / 1000;
    this.updateGlows(dt);
    const due = this.timers.filter(t => t.at <= this.time);
    if (due.length) {
      this.timers = this.timers.filter(t => t.at > this.time);
      due.forEach(t => t.fn());
    }

    // 列車位置：進站減速、出站加速
    const t = Math.min(1, this.phaseT / this.phaseLen);
    if (this.phase === 'arriving') this.trainX = 1500 * (1 - t) ** 2;
    // 出站：整列（CARS 節）都要開出畫面左邊
    else if (this.phase === 'leaving') this.trainX = -((CARS - DOCK_CAR) * (CAR_W + CAR_GAP) + 100) * t * t;
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

  /** 互動的柔光圈：從對方胸口慢慢擴散、淡出 */
  private updateGlows(dt: number) {
    this.particles.update(dt);
    const g = this.glow;
    g.clear();
    if (!this.glows.length) return;
    const color = hexToNum(PALETTES[this.mode].glow);
    this.glows = this.glows.filter(gl => (gl.t += dt) < 1.2 && !gl.actor.gone);
    for (const gl of this.glows) {
      const k = gl.t / 1.2;
      const cx = gl.actor.sprite.x + 32;
      const cy = gl.actor.sprite.y + 30;
      for (const [r, a] of [[14, 0.12], [9, 0.18], [5, 0.25]] as const) {
        g.circle(cx, cy, r + k * 8).fill({ color, alpha: a * (1 - k) });
      }
    }
  }

  dispose() {
    this.disposed = true;
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
  return [a.ceiling, a.back, a.car, ...a.carLeaves, a.psd, ...a.psdLeaves, a.floor, a.bench, ...a.transfers];
}
