// 車廂場景：窗景、霧氣車窗、乘客、光影、列車時鐘、車門（docs/PRD.md §2.5、§6.4）
// 連線時由伺服器驅動乘客、列車與留言；離線時本機模擬。到站開門可點車門下車，點兩端貫通道換車廂，點空位換座位。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import {
  CARS, FORTUNES, fortuneAt, isBigStation, LINES, isSpecial, isStand, NEAR_PRIORITY_COLUMNS, SEATS, spotColumn, STANDS, yieldTarget,
  type BoardedSnapshot, type GlowKind, type Mode, type Passenger, type ServerToClient, type SpotId, type WindowNote,
} from '@cc/shared';
import { mixer } from '../audio/AmbientMixer';
import { actions, devParams, store } from '../store';
import type { Actor, Label } from './actor';
import type { CharacterFrames } from './characters';
import { WindowGlass } from './glass';
import { buildInterior, doorHole, GANGWAY_W } from './interior';
import {
  A_CELL_Y, AISLE, B_CELL_Y, B_PANEL_Y, DOORS, FLOOR_Y, H, POLES, SEAT_W, SEAT_X0, STAND_CELL_Y, STRAP_XS, STRAP_Y, W,
  seatX, windowForSeat, windowRect,
} from './layout';
import { Lighting } from './lighting';
import { hexToNum, PALETTES } from './palette';
import { Particles } from './particles';
import { Passengers, type Arrival, type Pax } from './passengers';
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
  /** 車窗上的字：螢幕解析度 */
  readonly overlay = new Container();
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
  private gangwayFx = new Graphics();
  /** 互動效果：同頻波紋、蓋在 A 排／B 排乘客身上的小毯 */
  private waveFx = new Graphics();
  private blanketBack = new Graphics();
  private blanketFront = new Graphics();
  private waves = new Map<string, number>();
  private blankets = new Map<string, { since: number; until: number }>();
  private pops: { id: string; actor: Actor; text: string; born: number; ms: number }[] = [];
  /** 延遲動作（小插曲的分鏡）：跟著場景的時間走，場景收掉就不會再執行 */
  private timers: { at: number; fn: () => void }[] = [];
  /** 小插曲：車門被背包卡住時，門只關到這個程度 */
  private doorHold: number | null = null;
  private yielding = false;
  private popSeq = 0;
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
    this.glasses.forEach(g => {
      glassLayer.addChild(g.sprite);
      this.overlay.addChild(g.textView);
    });
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
      this.scenery.view, this.doorway, leafLayer, glassLayer, this.interiorBack, this.led, this.gangwayFx, strapLayer,
      this.passengers.backRow, this.blanketBack, this.handStraps, this.passengers.standRow,
      this.passengers.frontRow, this.blanketFront, this.waveFx, this.interiorFront, this.lighting.view, this.particles.view,
    );

    // ── 列車 ──
    this.train = new Train(lineId, {
      announce: next => {
        const s = this.train.line.stations[next];
        actions.say(`我們快到${s.zh}了。下車的朋友，慢慢來。｜Almost at ${s.en}. Take your time.`);
      },
      arrive: () => {
        const s = this.train.line.stations[this.train.to];
        store.setState({ train: { from: this.train.from, to: this.train.to, phase: 'dwell', arriveAt: this.train.leg.arriveAt } });
        actions.say(`${s.zh}到了。要下車就點車門；想再坐一會兒也沒關係。｜${s.en}. Tap a door to get off.`);
        if (!this.net) this.applyArrival(this.passengers.planLocalArrival(isBigStation(this.train.line, this.train.to)), String(Math.random()));
      },
      doorChime: () => {
        mixer.playDoorChime();
        actions.say('列車要出發了，想再坐一會兒也沒關係。');
      },
      depart: (from, to) => {
        store.setState({ train: { from, to, phase: 'run', arriveAt: this.train.leg.arriveAt } });
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
    store.setState({ scene: 'carriage', car: this.car, cars: CARS, train: { from: this.train.from, to: this.train.to, phase: this.train.phase, arriveAt: this.train.leg.arriveAt } });

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
    store.setState({ train: { from: this.train.from, to: this.train.to, phase: this.train.phase, arriveAt: this.train.leg.arriveAt } });
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
    on('glow', ({ to, kind, fortune }) => {
      const target = this.passengers.get(to);
      const toMe = to === this.selfPid;
      if (target) this.playInteraction(target, kind, toMe);
      if (toMe) {
        store.setState(s => ({
          received: { ...s.received, [kind]: s.received[kind] + 1 },
          ...(kind === 'fortune' && fortune !== null ? { lastFortune: fortune } : {}),
        }));
        actions.toast(receivedToast(kind, target?.state === 'music', fortune));
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
    on('pax:thanks', ({ pid }) => this.later(0.5, () => this.thanks(pid)));
    on('train:arrive', e => {
      e.leaving.forEach(pid => this.passengers.remove(pid));
      // 同一節車廂的人用同一顆種子挑小插曲，看到的是同一段
      const seed = [...e.npc.leave, ...e.npc.board.map(p => p.pid)].join() || e.station;
      this.applyArrival({ leave: e.npc.leave, board: e.npc.board, moves: [] }, seed);
    });
    on('train:depart', ({ train: t }) => this.train.setLeg(legFromSnapshot(this.train.line, t, net.offset), Date.now(), true));
    this.unsubscribe.push(net.onResync(snap => this.applySnapshot(snap, true)));
  }

  // ── 到站：NPC 上下車與開門小插曲（docs/PRD.md 第 20 章）──

  private later(sec: number, fn: () => void) {
    this.timers.push({ at: this.time + Math.max(0, sec), fn });
  }

  /** 到站的上下車；偶爾演一段 10 秒內的無聲小插曲 */
  private applyArrival(a: Arrival, seed: string) {
    a.moves.forEach(m => this.passengers.move(m.pid, m.seat));
    const left = this.train.leg.dwellMs - (Date.now() - this.train.leg.arriveAt);
    const roll = hash(seed) % 100;
    // 演小插曲的是一般乘客；長者與家長不跑也不卡門
    const cast = a.board.filter(p => !isSpecial(p.avatar));
    const leaver = a.leave.find(pid => {
      const p = this.passengers.get(pid);
      return p && !isSpecial(p.actor.look.avatar);
    });
    const episode = cast.length && leaver && roll < 15 && left > 9500
      ? 'door'
      : cast.length && roll >= 15 && roll < 27 && left > 7000 ? 'bag' : null;
    a.leave.forEach(pid => {
      if (episode !== 'door' || pid !== leaver) this.passengers.remove(pid);
    });
    a.board.forEach(p => this.passengers.add(p));
    if (episode === 'door') this.doorStandoff(leaver!, cast[0]);
    if (episode === 'bag') this.bagCaught(cast[cast.length - 1], left);
  }

  /** 靠近這個位子的車門 */
  private doorNear(seat: SpotId) {
    return spotColumn(seat) <= 3 ? 0 : 1;
  }

  /**
   * 小插曲①：下車的人走到門口，上車的人剛好也要進來，兩人在門口對看 2 秒，
   * 互相點頭，上車的人側身讓出去的人先走（先下後上）。
   */
  private doorStandoff(leaverPid: string, boarder: Passenger) {
    const from = this.passengers.get(leaverPid);
    if (!from) return;
    const door = DOORS[this.doorNear(from.seat)];
    const leaver = this.passengers.detach(leaverPid);
    const comer = this.passengers.hold(boarder.pid);
    if (!leaver || !comer) return;
    const x = door.x + door.w / 2 - 32;
    comer.placeAt(x, DOOR_CELL_Y);
    comer.setAnim('stand', 'front');
    leaver.walkTo([{ x: leaver.sprite.x, y: STAND_CELL_Y }, { x, y: STAND_CELL_Y }], 'back', () => {
      // 兩人同時往前一步，在門口對上
      leaver.walkTo([{ x, y: STAND_CELL_Y - 8 }], 'back');
      comer.walkTo([{ x, y: DOOR_CELL_Y + 8 }], 'front');
      this.later(0.5, () => {
        this.popOn(leaver, '…');
        this.popOn(comer, '…');
      });
      this.later(2.4, () => {
        this.nod(leaver);
        this.nod(comer);
        this.popOn(comer, '🙇');
      });
      this.later(3.4, () => comer.walkTo([{ x: x + 20, y: DOOR_CELL_Y + 8 }], 'front'));
      this.later(3.8, () => leaver.walkTo([{ x, y: DOOR_CELL_Y }], 'back', () => leaver.fadeOut()));
      this.later(5.2, () => this.walkToSeat(boarder.pid, comer, x + 20));
    });
  }

  /**
   * 小插曲②：最後一位衝進來的乘客背包卡到車門，關門警示音多響兩聲，門重新打開，人進來後才正常關門。
   * 只是畫面上的演出：列車照原本的時間發車。
   */
  private bagCaught(boarder: Passenger, leftMs: number) {
    const actor = this.passengers.hold(boarder.pid);
    if (!actor) return;
    // 先藏起來，快關門時才衝進來
    actor.sprite.alpha = 0;
    actor.fadeOut();
    const door = DOORS[this.doorNear(boarder.seat)];
    const x = door.x + door.w / 2 - 32;
    const start = (leftMs - 1600 - 4200) / 1000;
    this.later(start, () => {
      actor.placeAt(x - 34, DOOR_CELL_Y);
      actor.fadeIn();
      actor.walkTo([{ x, y: DOOR_CELL_Y }], 'front');
    });
    this.later(start + 0.9, () => {
      this.doorHold = 0.45;
      mixer.playDoorChime(4);
      this.popOn(actor, '🎒');
    });
    this.later(start + 1.7, () => {
      mixer.playDoorChime(2);
      this.popOn(actor, '！');
    });
    this.later(start + 2.4, () => {
      this.doorHold = null;
      this.walkToSeat(boarder.pid, actor, x);
    });
  }

  /** 從門口走進來，沿走道走到自己的位子坐好 */
  private walkToSeat(pid: string, actor: Actor, fromX: number) {
    const p = this.passengers.get(pid);
    if (!p) return;
    actor.walkTo([{ x: fromX, y: STAND_CELL_Y }, { x: seatX(p.seat), y: STAND_CELL_Y }], 'front', () => this.passengers.settle(pid));
  }

  /** 點頭：往下點兩次 */
  private nod(actor: Actor) {
    const y = actor.sprite.y;
    [[0, 2], [0.2, 0], [0.4, 2], [0.6, 0]].forEach(([t, dy]) => this.later(t, () => actor.placeAt(actor.sprite.x, y + dy)));
  }

  // ── 讓座（docs/PRD.md 第 20 章）──

  /** 自己坐在博愛座或隔壁欄，而且有長者或家長站著時：離自己最近的那一位 */
  private yieldCandidate(): Pax | null {
    if (isStand(this.selfSeat) || !NEAR_PRIORITY_COLUMNS.has(spotColumn(this.selfSeat)) || this.yielding) return null;
    const col = spotColumn(this.selfSeat);
    return this.passengers.standingSpecials()
      .sort((a, b) => Math.abs(spotColumn(a.seat) - col) - Math.abs(spotColumn(b.seat) - col))[0] ?? null;
  }

  /** 點了「🪑 讓座」：自己站到對方的站位拉吊環，對方坐下道謝 */
  async yieldSeat() {
    const target = this.yieldCandidate();
    if (!target) return;
    this.yielding = true;
    try {
      const mine = this.selfSeat;
      let stand = target.seat;
      if (this.net) {
        const res = await this.net.socket.timeout(4000).emitWithAck('seat:yield', { to: target.pid }).catch(() => null);
        if (!res?.ok) return actions.toast('對方好像已經找到位子了。');
        stand = res.data.seat;
      }
      const { avatar, gender, name } = target.actor.look;
      this.passengers.move(target.pid, mine);
      this.moveSelf(stand);
      this.later(0.5, () => this.thanks(target.pid));
      if (isSpecial(avatar)) {
        const to = yieldTarget(avatar, gender);
        store.setState(s => ({ yielded: { count: s.yielded.count + 1, to } }));
        actions.toast(`你站起來拉著吊環，把位子讓給了${name}。`);
      }
    } finally {
      this.yielding = false;
    }
  }

  /** 被讓座的人坐下後道謝：頭上浮起「✨ 謝謝」和一圈溫暖光暈 */
  private thanks(pid: string) {
    const p = this.passengers.get(pid);
    if (!p) return;
    this.showGlow(p);
    this.popOn(p.actor, '✨ 謝謝');
  }

  // ── 對其他乘客的互動（docs/PRD.md 第 17 章）──

  private showGlow(target: Pax) {
    const cx = target.actor.sprite.x + 32;
    const cy = target.actor.sprite.y + 14;
    this.lighting.addGlow(cx, cy);
    const tint = hexToNum(PALETTES[this.mode].glow);
    for (let i = 0; i < 6; i++) this.particles.emit('spark', cx - 8 + Math.random() * 16, cy - 4, tint);
  }

  /** 自己頭上浮出一個小圖示（例如切換情境音樂時的 🌱） */
  popSelf(text: string, ms?: number) {
    const self = this.passengers.get(this.selfPid);
    if (!self) return;
    // 連點切換時只留最新的一個
    this.pops = this.pops.filter(pop => pop.actor !== self.actor || !pop.id.startsWith('self'));
    this.pops.push({ id: `self${++this.popSeq}`, actor: self.actor, text, born: performance.now(), ms: ms ?? 1600 });
  }

  /** 頭上浮起一小段字（嗶！、♪、📜），1.6 秒後消失 */
  private pop(target: Pax, text: string) {
    this.popOn(target.actor, text);
  }

  private popOn(actor: Actor, text: string, ms = 1600) {
    this.pops.push({ id: `pop${++this.popSeq}`, actor, text, born: performance.now(), ms });
  }

  /** 全車看得到的互動效果；involved＝自己是送出者或收到的人（才聽得到嗶聲） */
  private playInteraction(target: Pax, kind: GlowKind, involved: boolean) {
    const now = Date.now();
    switch (kind) {
      case 'beep':
        this.showGlow(target);
        this.pop(target, '嗶！');
        if (involved) mixer.playCardBeep();
        break;
      case 'wave':
        if (target.state === 'music') {
          this.waves.set(target.pid, now + 3000);
          this.pop(target, '♪');
        } else {
          this.showGlow(target);
        }
        break;
      case 'blanket':
        if (target.state === 'sleep') this.blankets.set(target.pid, { since: now, until: now + 5 * 60_000 });
        break;
      case 'fortune':
        this.showGlow(target);
        this.pop(target, '📜');
        break;
    }
  }

  async glow(seat: SpotId, kind: GlowKind) {
    const target = this.passengers.at(seat);
    if (!target) return;
    let fortune: number | null = kind === 'fortune' ? Math.floor(Math.random() * FORTUNES.length) : null;
    if (this.net) {
      // 送出者的動畫在 ack 成功後於本機播放；伺服器不會把這則互動回送給送出者
      const res = await this.net.socket.timeout(4000).emitWithAck('glow:send', { to: target.pid, kind }).catch(() => null);
      if (!res) return;
      if (!res.ok) {
        if (res.code === 'RATE_LIMITED') actions.toast('剛剛才互動過，讓對方靜一靜吧。');
        if (res.code === 'NO_TARGET' && kind === 'blanket') actions.toast('對方醒著，小毯子先收著。');
        return;
      }
      fortune = res.data.fortune;
    }
    this.playInteraction(target, kind, true);
    if (kind === 'fortune' && fortune !== null) {
      const f = fortuneAt(fortune);
      actions.toast(`你遞出一張籤：「${f.text}」（${f.grade}）`);
    }
  }

  /** 波紋與小毯：每幀畫在對應的乘客身上 */
  private drawEffects() {
    const pal = PALETTES[this.mode];
    const now = Date.now();
    const fx = this.waveFx;
    fx.clear();
    for (const [pid, until] of this.waves) {
      const p = this.passengers.get(pid);
      if (!p || now > until) {
        this.waves.delete(pid);
        continue;
      }
      // 頭頂上 5 根跟著節拍跳的音樂波形
      const { x, y } = p.actor.headTop;
      const t = now / 1000;
      for (let i = 0; i < 5; i++) {
        const h = 2 + Math.round(4 * Math.abs(Math.sin(t * 7 + i * 1.3)));
        fx.rect(Math.round(x - 11 + i * 5), Math.round(y - 4 - h), 3, h).fill(hexToNum(i % 2 ? pal.glow : pal.ledOn));
      }
    }
    this.blanketBack.clear();
    this.blanketFront.clear();
    for (const [pid, b] of this.blankets) {
      const p = this.passengers.get(pid);
      if (!p || p.state !== 'sleep' || now > b.until) {
        this.blankets.delete(pid);
        continue;
      }
      // 半透明像素小毯：從胸口蓋到腿上，淡入 0.6 秒
      const alpha = Math.min(1, (now - b.since) / 600) * 0.78;
      const g = p.seat[1] === 'B' ? this.blanketFront : this.blanketBack;
      const { x, y } = p.actor.sprite;
      const top = y + 31;
      const base = hexToNum(this.mode === 'night' ? '#B48A9A' : '#D9B3A6');
      const stripe = hexToNum(this.mode === 'night' ? '#C9A3B1' : '#EBCFC4');
      g.rect(x + 18, top, 28, 21).fill({ color: base, alpha });
      g.rect(x + 18, top, 28, 2).fill({ color: stripe, alpha });
      for (let sx = x + 21; sx < x + 46; sx += 6) g.rect(sx, top + 4, 2, 17).fill({ color: stripe, alpha: alpha * 0.7 });
      g.rect(x + 17, top + 1, 1, 19).fill({ color: base, alpha });
      g.rect(x + 46, top + 1, 1, 19).fill({ color: base, alpha });
    }
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
      actions.setUi({ glowMenu: { target: hit.seat, name: hit.actor.look.name, state: hit.state, x: client.x, y: client.y }, noteMenu: null });
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

  setPixelScale(scale: number) {
    this.glasses.forEach(g => g.setResolution(scale));
  }

  labels(out: Label[]) {
    this.passengers.labels(out);
    const now = performance.now();
    this.pops = this.pops.filter(pop => now - pop.born < pop.ms);
    for (const pop of this.pops) {
      if (pop.actor.gone) continue;
      const k = (now - pop.born) / pop.ms;
      const { x, y } = pop.actor.headTop;
      out.push({ id: pop.id, name: pop.text, x, y: y - 10 - Math.round(Math.min(1, (now - pop.born) / 1600) * 10), alpha: k < 0.7 ? 1 : (1 - k) / 0.3, self: false, pop: true });
    }
    // 讓座提示：只有自己看得到，點了才讓
    const offer = this.yieldCandidate();
    const self = this.passengers.get(this.selfPid);
    if (offer && self) {
      const { x, y } = self.actor.headTop;
      out.push({ id: 'yield-hint', name: '🪑 讓座', x, y: y - 14, alpha: 1, self: false, hint: () => void this.yieldSeat() });
    }
    // 通道門指示牌：沒有下一節的那一側不顯示
    const y = 104;
    if (this.car > 1) {
      out.push({ id: 'gw-left', name: `❮ 第 ${this.car - 1} 車廂`, x: GANGWAY_W + 3, y, alpha: 1, self: false, sign: { align: 'left', action: () => this.hooks.moveCar(-1) } });
    }
    if (this.car < CARS) {
      out.push({ id: 'gw-right', name: `第 ${this.car + 1} 車廂 ❯`, x: W - GANGWAY_W - 3, y, alpha: 1, self: false, sign: { align: 'right', action: () => this.hooks.moveCar(1) } });
    }
  }

  /** 通道門上會動的像素箭頭：一閃一閃往門外推 */
  private drawGangwayArrows() {
    const pal = PALETTES[this.mode];
    const g = this.gangwayFx;
    g.clear();
    const phase = Math.floor(this.time * 3) % 3;
    for (const dir of [-1, 1] as const) {
      if (this.car + dir < 1 || this.car + dir > CARS) continue;
      const cx = dir === -1 ? GANGWAY_W / 2 : W - GANGWAY_W / 2;
      for (let k = 0; k < 3; k++) {
        const y = 70 + k * 30;
        const x = cx + dir * (phase - 1);
        const color = hexToNum(k === phase ? pal.ledOn : pal.light);
        for (let i = 0; i < 4; i++) {
          // 「❮」或「❯」：中間最尖
          g.rect(Math.round(x - dir * i - (dir === 1 ? 1 : 0)), y - i, 2, 1).fill(color);
          g.rect(Math.round(x - dir * i - (dir === 1 ? 1 : 0)), y + i, 2, 1).fill(color);
        }
      }
    }
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
    this.drawEffects();
    this.particles.update(dt);
    this.lighting.update(dt, train, this.scenery, rm);

    const due = this.timers.filter(t => t.at <= this.time);
    if (due.length) {
      this.timers = this.timers.filter(t => t.at > this.time);
      due.forEach(t => t.fn());
    }

    // 車門：到站停妥後打開，關門警示音響起後關上；小插曲裡被背包卡住時只關到一半
    const dwellT = now - train.leg.arriveAt;
    const wantOpen = train.phase === 'dwell' && dwellT > 700 && dwellT < train.leg.dwellMs - 1600;
    const target = wantOpen ? (this.doorHold ?? 1) : 0;
    const step = dt * 1.2;
    this.doorOpen = Math.abs(target - this.doorOpen) <= step ? target : this.doorOpen + Math.sign(target - this.doorOpen) * step;
    const slide = Math.round((rm ? target : ease(this.doorOpen)) * DOOR_SLIDE);
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
      this.drawGangwayArrows();
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
      this.overlay.destroy({ children: true });
      art.forEach(t => t.destroy(true));
    });
  }

  /** 開發用：叫一位長者或家長上車、演一段小插曲 */
  debugSpecial() {
    const board: Passenger[] = [];
    this.passengers.planSpecial(board);
    board.forEach(p => this.passengers.add(p));
  }

  debugEpisode(kind: 'door' | 'bag') {
    const npc = this.passengers.all.find(p => p.npc && p.pid !== this.selfPid);
    const seat = this.passengers.freeSeat();
    if (!npc || !seat) return;
    const comer: Passenger = { pid: `local_ep${Date.now()}`, seat, name: '阿哲', gender: 'm', avatar: 'student', state: 'idle', since: Date.now(), npc: true };
    this.passengers.add(comer);
    if (kind === 'door') this.doorStandoff(npc.pid, comer);
    else this.bagCaught(comer, 1600 + 4200 + 300);
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
/** 站在車門口（腳踩在門檻上）時的 cell 左上角 y */
const DOOR_CELL_Y = FLOOR_Y - 62;

/** 字串雜湊：同一節車廂的人用同一個種子挑小插曲 */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 收到互動的人看到的提示（只有自己看得到） */
function receivedToast(kind: GlowKind, listening: boolean, fortune: number | null) {
  switch (kind) {
    case 'beep': return '有人刷了一下隨行卡：嗶！跟你打聲招呼。';
    case 'wave': return listening ? '有人跟你同頻，一起聽著這首歌。' : '有人遞給你一點溫暖的微光。';
    case 'blanket': return '有人幫你蓋上一條小毯子。好好睡。';
    case 'fortune': {
      const f = fortuneAt(fortune ?? 0);
      return `有人遞給你一張籤：「${f.text}」（${f.grade}）`;
    }
  }
}

/** 車門上方 LED 路線圖：原創像素線條＋虛擬站點；下一站閃爍。轉乘站下方加註轉乘路線色塊（§23.3），駛近時雙色交替 */
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
    stations.forEach((st, i) => {
      const x = Math.round(x0 + (i / (stations.length - 1)) * span) - 1;
      const passed = train.dir === 1 ? i < train.to : i > train.to;
      const isNext = i === train.to;
      const transfers = st.transfer ?? [];
      // 駛近轉乘站：站點與色塊在 LED 色和轉乘路線色之間交替
      const alternate = isNext && transfers.length > 0 && train.phase !== 'dwell';
      let color = hexToNum(isNext ? (train.phase === 'dwell' || blinkOn ? pal.ledOn : pal.ledDim) : passed ? pal.ledDim : pal.ledOn);
      if (alternate) color = blinkOn ? hexToNum(pal.ledOn) : hexToNum(LINES[transfers[0]].color);
      g.rect(x, y - 1, 3, 3).fill(color);
      transfers.forEach((to, k) => {
        const tag = hexToNum(LINES[to].color);
        const tx = x + k * 4;
        g.rect(tx + 1, y + 2, 1, 1).fill({ color: hexToNum(pal.ledDim) });
        g.rect(tx, y + 4, 3, 2).fill(alternate && blinkOn ? tag : alternate ? hexToNum(pal.ledOn) : tag);
        if (passed && !isNext) g.rect(tx, y + 4, 3, 2).fill({ color: hexToNum(pal.led), alpha: 0.45 });
      });
    });
    const ax = Math.round(x0 + (train.to / (stations.length - 1)) * span) + (train.dir === 1 ? -6 : 4);
    g.rect(ax, y - 5, 2, 1).fill(hexToNum(pal.ledOn));
  }
}
