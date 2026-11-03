// 車廂場景：窗景、霧氣車窗、乘客、光影、列車時鐘、車門（docs/PRD.md §2.5、§6.4）
// 連線時由伺服器驅動乘客、列車與留言；離線時本機模擬。到站開門可點車門下車，點兩端貫通道換車廂，點空位換座位。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import {
  CARS, SEATS, STANDS, type BoardedSnapshot, type GlowKind, type Mode, type ServerToClient, type SpotId, type WindowNote,
} from '@cc/shared';
import { mixer } from '../audio/AmbientMixer';
import { actions, devParams, store } from '../store';
import type { Label } from './actor';
import type { CharacterFrames } from './characters';
import { WindowGlass } from './glass';
import { buildInterior, doorHole, GANGWAY_W } from './interior';
import {
  A_CELL_Y, AISLE, B_CELL_Y, B_PANEL_Y, DOORS, FLOOR_Y, H, POLES, SEAT_W, SEAT_X0, STRAP_XS, STRAP_Y, W,
  seatX, windowForSeat, windowRect,
} from './layout';
import { Lighting } from './lighting';
import { hexToNum, PALETTES } from './palette';
import { Particles } from './particles';
import { Passengers, type Pax } from './passengers';
import type { Scene } from './scene';
import { Scenery } from './scenery';
import { buildScenery } from './sceneryArt';
import { legFromSnapshot, Train } from './train';
import type { NetLink } from '../net/session';

const GLASS_INTERVAL = 1 / 20;
export const LOCAL_SELF = 'self';
/** 門扇滑開的距離 */
const DOOR_SLIDE = 34;

export interface CarriageHooks {
  /** 開著的車門被點了：下車 */
  alight(): void;
  /** 點了兩端的貫通道 */
  moveCar(dir: -1 | 1): void;
  /** 點了空位或走道（站著拉吊環） */
  moveSeat(seat: SpotId): void;
}

type Start =
  | { kind: 'online'; net: NetLink; snapshot: BoardedSnapshot }
  | { kind: 'offline'; station: number; toward: number; car: number };

export class CarriageScene implements Scene {
  readonly kind = 'carriage';
  readonly world = new Container();
  readonly train: Train;
  private net: NetLink | null;
  private scenery = new Scenery();
  private glasses = Array.from({ length: 6 }, (_, i) => new WindowGlass(i));
  private interiorBack = new Sprite();
  private interiorFront = new Sprite();
  private doorway = new Graphics();
  private leaves: Sprite[] = [];
  private led = new Graphics();
  /** 站著的人握著的吊環 */
  private handStraps = new Graphics();
  private straps: Sprite[];
  private strapArt: Texture[] = [];
  private particles = new Particles();
  private passengers: Passengers;
  private lighting = new Lighting();
  private art: Texture[] = [];
  private mode: Mode = 'night';

  private selfPid = LOCAL_SELF;
  selfSeat: SpotId = '3B';
  car = 1;
  /** 列車編號（車票用） */
  trainId: string;
  /** 每扇窗目前的留言；mine 用來決定點窗時是「寫字」還是「擦掉／檢舉」 */
  private windowNotes = new Map<number, { nid: string; mine: boolean }>();
  private myNids = new Set<string>();
  /** 同車過的真人乘客（車票上的「和 N 位陌生人同行」） */
  private riders = new Set<string>();
  private unsubscribe: (() => void)[] = [];

  private doorOpen = 0;
  private glassAcc = 0;
  private ledAcc = 0;
  private lastTunnel: boolean;
  private strapPos = 0;
  private strapVel = 0;
  private time = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(start: Start, private hooks: CarriageHooks) {
    this.net = start.kind === 'online' ? start.net : null;
    const lineId = start.kind === 'online' ? start.snapshot.room.line : store.getState().line;
    this.trainId = start.kind === 'online' ? start.snapshot.room.train : `${lineId}-0000`;

    // ── 場景圖層（由後到前）──
    const glassLayer = new Container();
    this.glasses.forEach(g => glassLayer.addChild(g.sprite));
    const leafLayer = new Container();
    for (const d of DOORS) {
      const hole = doorHole(d);
      const mask = new Graphics().rect(hole.x, hole.y, hole.w, hole.h).fill(0xffffff);
      const box = new Container();
      box.mask = mask;
      const pair = [new Sprite(), new Sprite()];
      pair.forEach(s => (s.y = hole.y));
      box.addChild(...pair);
      leafLayer.addChild(mask, box);
      this.leaves.push(...pair);
    }
    const strapLayer = new Container();
    this.straps = STRAP_XS.map(x => {
      const s = new Sprite();
      s.position.set(x - 4, STRAP_Y + 2);
      strapLayer.addChild(s);
      return s;
    });
    this.passengers = new Passengers(
      this.particles,
      () => hexToNum(PALETTES[this.mode].ledOn),
      !this.net,
      () => this.selfPid,
    );
    this.interiorFront.y = B_PANEL_Y;
    this.world.addChild(
      this.scenery.view, this.doorway, leafLayer, glassLayer, this.interiorBack, this.led, strapLayer,
      this.passengers.backRow, this.handStraps, this.passengers.standRow, this.passengers.frontRow, this.interiorFront, this.lighting.view, this.particles.view,
    );

    // ── 列車 ──
    this.train = new Train(lineId, {
      announce: next => {
        const s = this.train.line.stations[next];
        actions.say(`我們快到${s.zh}了。下車的朋友，慢慢來。｜Almost at ${s.en}. Take your time.`);
      },
      arrive: () => {
        const s = this.train.line.stations[this.train.to];
        store.setState({ train: { from: this.train.from, to: this.train.to, phase: 'dwell' } });
        actions.say(`${s.zh}到了。要下車就點車門；想再坐一會兒也沒關係。｜${s.en}. Tap a door to get off.`);
        if (!this.net) this.passengers.shuffleLocalAtStation();
      },
      doorChime: () => {
        mixer.playDoorChime();
        actions.say('列車要出發了，想再坐一會兒也沒關係。');
      },
      depart: (from, to) => {
        store.setState({ train: { from, to, phase: 'run' } });
        this.scenery.onDepart(this.train);
      },
    }, this.net ? null : { runSec: devParams.runSec });

    if (start.kind === 'online') {
      this.bindServer(start.net);
      this.applySnapshot(start.snapshot, false);
    } else {
      // 停站時間要夠走進來坐下
      this.train.startAtStation(start.station, start.toward, Date.now(), Math.max(6000, devParams.dwellSec * 600));
      this.car = start.car;
      this.populateLocal();
    }
    this.lastTunnel = this.train.inTunnel;
    mixer.setSegment(this.lastTunnel ? 'underground' : 'elevated');
    store.setState({ scene: 'carriage', car: this.car, cars: CARS, train: { from: this.train.from, to: this.train.to, phase: this.train.phase } });

    // 自己的狀態：本機立即反映，再（去抖動後）同步給同車乘客
    let stateTimer: ReturnType<typeof setTimeout> | undefined;
    this.unsubscribe.push(store.subscribe((s, prev) => {
      if (s.selfState !== prev.selfState) {
        this.passengers.setState(this.selfPid, s.selfState);
        if (this.net) {
          const net = this.net;
          clearTimeout(stateTimer);
          stateTimer = setTimeout(() => void net.socket.timeout(4000).emitWithAck('state:set', { state: store.getState().selfState }).catch(() => {}), 600);
        }
      }
      if (this.net && s.dnd !== prev.dnd) {
        void this.net.socket.timeout(4000).emitWithAck('pref:set', { dnd: s.dnd }).catch(() => {});
      }
    }));
    this.unsubscribe.push(() => clearTimeout(stateTimer));
  }

  /** 此刻抵達（或剛離開）的站 */
  currentStation() {
    return this.train.phase === 'dwell' ? this.train.to : this.train.from;
  }

  get doorsOpen() {
    return this.doorOpen > 0.5;
  }

  // ── 乘客與留言 ──

  private noteRider(p: { pid: string; npc?: boolean }) {
    if (p.npc || p.pid === this.selfPid || this.riders.has(p.pid)) return;
    this.riders.add(p.pid);
    store.setState(s => (s.ride ? { ride: { ...s.ride, coRiders: s.ride.coRiders + 1 } } : {}));
  }

  private applyNote(n: WindowNote) {
    const offset = this.net?.offset ?? 0;
    this.glasses[n.window].writeNote(n.text, n.expiresAt - n.createdAt, n.createdAt - offset);
    this.windowNotes.set(n.window, { nid: n.nid, mine: this.myNids.has(n.nid) });
  }

  private clearNotes() {
    this.glasses.forEach(g => g.clearNote());
    this.windowNotes.clear();
  }

  /** 連線時的整節車廂快照：上車、重連、換車廂都走這裡 */
  applySnapshot(snap: BoardedSnapshot, isResync: boolean) {
    this.passengers.clear();
    snap.passengers.forEach(p => this.passengers.add(p, false));
    this.selfPid = snap.you.pid;
    this.selfSeat = snap.you.seat;
    this.car = snap.room.car;
    const self = this.passengers.get(this.selfPid);
    if (self && self.state !== store.getState().selfState) this.passengers.setState(this.selfPid, store.getState().selfState);
    store.setState({ selfPid: this.selfPid, selfSeat: this.selfSeat, car: this.car, cars: snap.room.cars, name: snap.you.name });
    this.clearNotes();
    snap.notes.forEach(n => this.applyNote(n));
    this.train.setLeg(legFromSnapshot(this.train.line, snap.train, this.net?.offset ?? 0), Date.now(), false);
    store.setState({ train: { from: this.train.from, to: this.train.to, phase: this.train.phase } });
    snap.passengers.forEach(p => this.noteRider(p));
    if (isResync) this.scenery.onDepart(this.train);
  }

  /** 離線：本機模擬這節車廂的乘客（上車、換車廂時） */
  populateLocal() {
    this.passengers.clear();
    this.clearNotes();
    for (let i = 0; i < 4 + Math.floor(Math.random() * 2); i++) this.passengers.boardLocalNpc();
    this.selfSeat = this.passengers.freeSeat() ?? '3B';
    const { name, gender, avatar, selfState } = store.getState();
    this.passengers.add({ pid: LOCAL_SELF, seat: this.selfSeat, name, gender, avatar, state: selfState, since: Date.now() });
    store.setState({ selfPid: this.selfPid, selfSeat: this.selfSeat, car: this.car });
    // 示範用：已經有人在窗上寫過一句話
    if (Math.random() < 0.6) {
      const demo = [0, 1, 2, 3, 4, 5].find(i => i !== windowForSeat(this.selfSeat) && Math.random() < 0.4) ?? 0;
      const text = ['今天也要好好吃飯', '慢慢來比較快', '明天會更好', '辛苦了'][Math.floor(Math.random() * 4)];
      this.applyNote({ nid: `demo_${Date.now()}`, window: demo, text, mode: this.mode, createdAt: Date.now() - 30_000, expiresAt: Date.now() + devParams.noteTtlSec * 1000 });
    }
  }

  /** 換座位或站起來（伺服器已確認，或離線） */
  moveSelf(seat: SpotId) {
    this.passengers.move(this.selfPid, seat);
    this.selfSeat = seat;
    store.setState({ selfSeat: seat });
  }

  /** 離線換車廂 */
  moveCarLocal(car: number) {
    this.car = car;
    this.populateLocal();
  }

  isFree(seat: SpotId) {
    return !this.passengers.at(seat);
  }

  private bindServer(net: NetLink) {
    const { socket } = net;
    const on = <E extends keyof ServerToClient>(event: E, fn: ServerToClient[E]) => {
      socket.on(event, fn as never);
      this.unsubscribe.push(() => socket.off(event, fn as never));
    };
    on('pax:join', p => {
      this.passengers.add(p);
      this.noteRider(p);
    });
    on('pax:leave', ({ pid }) => this.passengers.remove(pid));
    on('pax:move', ({ pid, seat }) => this.passengers.move(pid, seat));
    on('pax:state', ({ pid, state }) => {
      if (pid !== this.selfPid) this.passengers.setState(pid, state);
    });
    on('glow', ({ to, kind }) => {
      const target = this.passengers.get(to);
      if (target) this.showGlow(target);
      if (to === this.selfPid) {
        store.setState(s => ({ cheersReceived: s.cheersReceived + 1 }));
        actions.toast(GLOW_TOAST[kind]);
      }
    });
    on('note:new', n => this.applyNote(n));
    on('note:gone', ({ nid }) => {
      for (const [w, n] of this.windowNotes) {
        if (n.nid !== nid) continue;
        this.glasses[w].clearNote();
        this.windowNotes.delete(w);
      }
    });
    on('train:arrive', e => {
      e.leaving.forEach(pid => this.passengers.remove(pid));
      e.npc.leave.forEach(pid => this.passengers.remove(pid));
      e.npc.board.forEach(p => this.passengers.add(p));
    });
    on('train:depart', ({ train: t }) => this.train.setLeg(legFromSnapshot(this.train.line, t, net.offset), Date.now(), true));
    this.unsubscribe.push(net.onResync(snap => this.applySnapshot(snap, true)));
  }

  // ── 微光 ──

  private showGlow(target: Pax) {
    const cx = target.actor.sprite.x + 32;
    const cy = target.actor.sprite.y + 14;
    this.lighting.addGlow(cx, cy);
    const tint = hexToNum(PALETTES[this.mode].glow);
    for (let i = 0; i < 6; i++) this.particles.emit('spark', cx - 8 + Math.random() * 16, cy - 4, tint);
  }

  async glow(seat: SpotId, kind: GlowKind) {
    const target = this.passengers.at(seat);
    if (!target) return;
    if (this.net) {
      // 送出者的動畫在 ack 成功後於本機播放；伺服器不會把這則微光回送給送出者
      const res = await this.net.socket.timeout(4000).emitWithAck('glow:send', { to: target.pid, kind }).catch(() => null);
      if (!res?.ok) return;
    }
    this.showGlow(target);
  }

  // ── 霧氣留言 ──

  async writeNote(text: string) {
    if (!this.net) {
      const now = Date.now();
      const window = windowForSeat(this.selfSeat);
      this.applyNote({ nid: `local_${now}`, window, text, mode: this.mode, createdAt: now, expiresAt: now + devParams.noteTtlSec * 1000 });
      this.windowNotes.get(window)!.mine = true;
      return { ok: true as const };
    }
    try {
      const res = await this.net.socket.timeout(4000).emitWithAck('note:write', { text });
      if (!res.ok) return res;
      this.myNids.add(res.data.nid);
      // note:new 可能比 ack 先到：補標記為自己的留言
      for (const n of this.windowNotes.values()) if (n.nid === res.data.nid) n.mine = true;
      return { ok: true as const };
    } catch {
      return { ok: false as const, code: 'NETWORK' as const };
    }
  }

  wipeNote(window: number) {
    this.glasses[window].clearNote();
    this.windowNotes.delete(window);
  }

  async reportNote(window: number) {
    const note = this.windowNotes.get(window);
    this.wipeNote(window);
    if (this.net && note) await this.net.socket.timeout(4000).emitWithAck('note:report', { nid: note.nid }).catch(() => {});
  }

  // ── 場景介面 ──

  tap(x: number, y: number, client: { x: number; y: number }) {
    const hit = this.passengers.all.find(
      p => p.pid !== this.selfPid
        && x >= p.actor.sprite.x + 14 && x < p.actor.sprite.x + 50 && y >= p.actor.sprite.y + 4 && y < p.actor.sprite.y + 62,
    );
    if (hit) {
      actions.setUi({ glowMenu: { seat: hit.seat, name: hit.actor.look.name, x: client.x, y: client.y }, noteMenu: null });
      return;
    }
    actions.setUi({ glowMenu: null, noteMenu: null });

    const win = [0, 1, 2, 3, 4, 5].find(i => {
      const r = windowRect(i);
      return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    });
    if (win !== undefined) {
      const note = this.windowNotes.get(win);
      if (note && !note.mine && this.glasses[win].hasNote) {
        actions.setUi({ noteMenu: { window: win, x: client.x, y: client.y } });
      } else {
        actions.setUi({ composerOpen: true });
      }
      return;
    }

    if (y >= 40 && y < FLOOR_Y + 6) {
      const door = DOORS.find(d => x >= d.x && x < d.x + d.w);
      if (door) {
        if (this.doorsOpen) this.hooks.alight();
        else actions.toast(this.train.phase === 'dwell' ? '車門正在開關，等一下下。' : '列車行駛中，到站開門後才能下車。');
        return;
      }
      if (x < GANGWAY_W || x >= W - GANGWAY_W) {
        const dir = x < GANGWAY_W ? -1 : 1;
        if (this.car + dir < 1 || this.car + dir > CARS) actions.toast(dir === -1 ? '這裡是第一節車廂了。' : '這裡是最後一節車廂了。');
        else this.hooks.moveCar(dir);
        return;
      }
    }

    const seat = SEATS.find(s => {
      const sx = seatX(s);
      const top = s[1] === 'A' ? A_CELL_Y + 8 : B_CELL_Y + 8;
      const bottom = s[1] === 'A' ? FLOOR_Y : H;
      return x >= sx + 4 && x < sx + SEAT_W - 4 && y >= top && y < bottom;
    });
    if (seat) {
      if (seat !== this.selfSeat && this.isFree(seat)) this.hooks.moveSeat(seat);
      return;
    }

    // 走道或立柱旁：站起來拉吊環（找離點擊處最近的空站位）
    const nearPole = POLES.some(px => Math.abs(x - px) < 10) && y >= 40;
    if ((y >= AISLE.top && y < AISLE.bottom) || nearPole) {
      const col = Math.max(1, Math.min(6, Math.floor((x - SEAT_X0) / SEAT_W) + 1));
      const spot = [...STANDS]
        .filter(s => s === this.selfSeat || this.isFree(s))
        .sort((a, b) => Math.abs(Number(a[1]) - col) - Math.abs(Number(b[1]) - col))[0];
      if (spot && spot !== this.selfSeat) this.hooks.moveSeat(spot);
    }
  }

  focusX() {
    return seatX(this.selfSeat) + SEAT_W / 2;
  }

  labels(out: Label[]) {
    this.passengers.labels(out);
  }

  colors(mode: Mode) {
    const pal = PALETTES[mode];
    return { top: pal.ceiling, edge: pal.ceilingLight, bottom: pal.floor, background: mode === 'night' ? '#2E2C38' : '#D6CDBE' };
  }

  setMode(mode: Mode, chars: CharacterFrames) {
    this.mode = mode;
    const pal = PALETTES[mode];
    const interior = buildInterior(pal, this.train.line.seatColor);
    const sceneryArt = buildScenery(pal, mode === 'night', this.train.line.color);
    this.interiorBack.texture = interior.back;
    this.interiorFront.texture = interior.front;
    this.strapArt = interior.straps;
    this.leaves.forEach((s, i) => (s.texture = interior.doorLeaves[i % 2]));
    this.scenery.setArt(sceneryArt, this.train);
    this.glasses.forEach(g => g.setPalette(pal, mode === 'night'));
    this.lighting.setPalette(pal, mode);
    this.passengers.setFrames(chars);
    this.drawDoorway();
    const old = this.art;
    this.art = [
      interior.back, interior.front, ...interior.straps, ...interior.doorLeaves,
      sceneryArt.sky, sceneryArt.far, sceneryArt.tunnel, sceneryArt.platformOpen, sceneryArt.platformUnder,
      ...Object.values(sceneryArt.mid), ...Object.values(sceneryArt.near), ...sceneryArt.rain,
    ];
    requestAnimationFrame(() => old.forEach(t => t.destroy(true)));
  }

  /** 門開時露出的月台地面（車窗景觀帶只到 y=140） */
  private drawDoorway() {
    const pal = PALETTES[this.mode];
    const g = this.doorway;
    g.clear();
    for (const d of DOORS) {
      const hole = doorHole(d);
      g.rect(hole.x, 140, hole.w, FLOOR_Y - 140).fill(hexToNum(pal.platformTile));
      g.rect(hole.x, FLOOR_Y - 6, hole.w, 3).fill(hexToNum(pal.warning));
    }
  }

  update(dt: number, now: number) {
    const rm = this.reducedMotion.matches;
    const { rain } = store.getState();
    const train = this.train;
    this.time += dt;

    train.update(dt, now);
    if (train.inTunnel !== this.lastTunnel) {
      this.lastTunnel = train.inTunnel;
      mixer.setSegment(this.lastTunnel ? 'underground' : 'elevated');
    }
    this.scenery.update(dt, train, rain, rm);
    this.passengers.update(dt);
    this.drawHandStraps();
    this.particles.update(dt);
    this.lighting.update(dt, train, this.scenery, rm);

    // 車門：到站停妥後打開，關門警示音響起後關上
    const dwellT = now - train.leg.arriveAt;
    const wantOpen = train.phase === 'dwell' && dwellT > 700 && dwellT < train.leg.dwellMs - 1600;
    this.doorOpen = Math.max(0, Math.min(1, this.doorOpen + (wantOpen ? 1 : -1) * dt * 1.2));
    const slide = Math.round((rm ? (wantOpen ? 1 : 0) : ease(this.doorOpen)) * DOOR_SLIDE);
    DOORS.forEach((d, i) => {
      const hole = doorHole(d);
      this.leaves[i * 2].x = hole.x - slide;
      this.leaves[i * 2 + 1].x = hole.x + hole.w / 2 + slide;
    });

    // 吊環：由列車加速度驅動的阻尼彈簧，到站時一起前傾
    const sway = rm ? 0 : -train.accel * 14 + (train.speed > 0.6 ? Math.sin(this.time * 1.3) * 0.5 : 0);
    this.strapVel += (sway - this.strapPos) * 6 * dt - this.strapVel * 3 * dt;
    this.strapPos += this.strapVel * dt;
    this.straps.forEach((s, i) => {
      const lean = Math.round(Math.max(-2, Math.min(2, this.strapPos + (i % 3 === 0 ? 0.3 : 0))));
      s.texture = this.strapArt[lean + 2];
    });

    this.glassAcc += dt;
    if (this.glassAcc >= GLASS_INTERVAL) {
      this.glasses.forEach(g => g.update(this.glassAcc, now, rain, train.speed, rm));
      this.glassAcc = 0;
    }

    this.ledAcc += dt;
    if (this.ledAcc >= 0.25) {
      this.ledAcc = 0;
      drawLed(this.led, train, this.mode, Math.floor(this.time * 2) % 2 === 0);
    }
  }

  /** 站著的人舉手握住的吊環：從橫桿垂下來到手上 */
  private drawHandStraps() {
    const pal = PALETTES[this.mode];
    const g = this.handStraps;
    g.clear();
    for (const p of this.passengers.standing()) {
      const { x, y, alpha } = p.actor.sprite;
      if (alpha <= 0) continue;
      const hx = x + 43;
      g.rect(hx, STRAP_Y + 2, 2, y - STRAP_Y - 4).fill({ color: hexToNum(pal.metalLo), alpha });
      g.rect(hx - 2, y - 4, 6, 1).fill({ color: hexToNum(pal.metal), alpha });
      g.rect(hx - 3, y - 3, 1, 5).fill({ color: hexToNum(pal.metal), alpha });
      g.rect(hx + 4, y - 3, 1, 5).fill({ color: hexToNum(pal.metal), alpha });
    }
  }

  dispose() {
    this.unsubscribe.forEach(fn => fn());
    this.unsubscribe = [];
    const art = this.art;
    requestAnimationFrame(() => {
      this.world.destroy({ children: true });
      art.forEach(t => t.destroy(true));
    });
  }

  /** 開發用 */
  debug() {
    return {
      pax: this.passengers.all.map(p => ({ pid: p.pid, name: p.actor.look.name, seat: p.seat, state: p.state, npc: p.npc })),
      train: { from: this.train.from, to: this.train.to, phase: this.train.phase, speed: +this.train.speed.toFixed(2), doorOpen: +this.doorOpen.toFixed(2) },
      notes: [...this.windowNotes.entries()].map(([w, n]) => ({ window: w, ...n, visible: this.glasses[w].hasNote })),
      car: this.car,
    };
  }
}

const ease = (t: number) => t * t * (3 - 2 * t);

const GLOW_TOAST: Record<GlowKind, string> = {
  nod: '有人對你點了點頭。',
  light: '有人遞給你一點微光。',
  pat: '有人輕輕拍了拍你的肩膀。',
};

/** 車門上方 LED 路線圖：原創像素線條＋虛擬站點；下一站閃爍 */
function drawLed(g: Graphics, train: Train, mode: Mode, blinkOn: boolean) {
  const pal = PALETTES[mode];
  const stations = train.line.stations;
  const line = hexToNum(train.line.color);
  g.clear();
  for (const d of DOORS) {
    const x0 = d.x + 9;
    const span = d.w - 18;
    const y = 15;
    g.rect(x0, y, span, 1).fill({ color: line, alpha: 0.8 });
    stations.forEach((_, i) => {
      const x = Math.round(x0 + (i / (stations.length - 1)) * span) - 1;
      const passed = train.dir === 1 ? i < train.to : i > train.to;
      const isNext = i === train.to;
      const color = isNext ? (train.phase === 'dwell' || blinkOn ? pal.ledOn : pal.ledDim) : passed ? pal.ledDim : pal.ledOn;
      g.rect(x, y - 1, 3, 3).fill(hexToNum(color));
    });
    const ax = Math.round(x0 + (train.to / (stations.length - 1)) * span) + (train.dir === 1 ? -6 : 4);
    g.rect(ax, y - 5, 2, 1).fill(hexToNum(pal.ledOn));
  }
}
