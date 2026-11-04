// 車廂乘客：連線時由伺服器的 pax:* 事件驅動；離線模式由本機模擬 NPC（docs/PRD.md §7.4）
// 長者與家長（第 20 章）在大站上車：有空的博愛座就坐，否則站著，等人讓座。
import { Container } from 'pixi.js';
import {
  isSpecial, isStand, npcIdentity, PAX_STATES, pickSeat, PRIORITY_SEATS, SPECIAL_KINDS, SPECIAL_STANDS, specialIdentity,
  type Passenger, type PaxState, type SeatId, type SpotId,
} from '@cc/shared';
import { Actor, type Label } from './actor';
import type { CharacterFrames, View } from './characters';
import { seatCellY, seatX } from './layout';
import type { Particles } from './particles';

export interface Pax {
  pid: string;
  seat: SpotId;
  state: PaxState;
  npc: boolean;
  actor: Actor;
  emitTimer: number;
  nextChange: number;
  /** 正在走進車門或演小插曲：位置與動作由車廂場景操控 */
  scripted?: boolean;
}

/** 到站時誰下車、誰上車，以及站著的長者改坐空出來的博愛座 */
export interface Arrival {
  leave: string[];
  board: Passenger[];
  moves: { pid: string; seat: SpotId }[];
}

export const isSpecialPax = (p: Pax) => p.npc && isSpecial(p.actor.look.avatar);

const viewOf = (seat: SpotId): View => (isStand(seat) || seat[1] === 'A' ? 'front' : 'back');
/** 站著的人一律舉手拉吊環 */
const animOf = (seat: SpotId, state: PaxState) => (isStand(seat) ? 'hang' as const : state);

export class Passengers {
  readonly backRow = new Container();
  /** 走道上站著的人：在兩排長椅之間 */
  readonly standRow = new Container();
  readonly frontRow = new Container();
  private list: Pax[] = [];
  /** 正在淡出的角色（下車、換座位的舊位置） */
  private leaving: Actor[] = [];
  private frames: CharacterFrames | undefined;
  private localSeq = 0;
  /** 離線模式：長者與家長還要坐幾站 */
  private specialLeft = new Map<string, number>();

  /** autonomous：離線模式下 NPC 自己換姿勢、自己上下車 */
  constructor(
    private particles: Particles,
    private zzzTint: () => number,
    private autonomous: boolean,
    private selfPid: () => string,
  ) {}

  setFrames(frames: CharacterFrames) {
    this.frames = frames;
  }

  get all(): readonly Pax[] {
    return this.list;
  }

  get(pid: string) {
    return this.list.find(p => p.pid === pid);
  }

  at(seat: SpotId) {
    return this.list.find(p => p.seat === seat);
  }

  add(p: Passenger, fadeIn = true): Pax {
    const existing = this.get(p.pid);
    if (existing) return existing;
    const actor = new Actor(p.pid, { name: p.name, gender: p.gender, avatar: p.avatar, npc: !!p.npc }, animOf(p.seat, p.state), viewOf(p.seat), seatX(p.seat), seatCellY(p.seat), fadeIn);
    (isStand(p.seat) ? this.standRow : p.seat[1] === 'A' ? this.backRow : this.frontRow).addChild(actor.sprite);
    const pax: Pax = {
      pid: p.pid, seat: p.seat, state: p.state, npc: !!p.npc, actor,
      emitTimer: Math.random(), nextChange: 40 + Math.random() * 80,
    };
    this.list.push(pax);
    return pax;
  }

  /** 下車：淡出後移除 */
  remove(pid: string) {
    const p = this.get(pid);
    if (!p) return;
    this.list = this.list.filter(x => x !== p);
    p.actor.fadeOut();
    this.leaving.push(p.actor);
  }

  /** 換座位（或站起來）：舊位置淡出、新位置淡入 */
  move(pid: string, seat: SpotId) {
    const p = this.get(pid);
    if (!p || p.seat === seat) return;
    this.remove(pid);
    this.add({ pid, seat, name: p.actor.look.name, gender: p.actor.look.gender, avatar: p.actor.look.avatar, state: p.state, since: Date.now(), ...(p.npc ? { npc: true as const } : {}) });
  }

  /** 重新同步、換車廂時立即清空 */
  clear() {
    [...this.list.map(p => p.actor), ...this.leaving].forEach(a => a.sprite.destroy());
    this.list = [];
    this.leaving = [];
  }

  setState(pid: string, state: PaxState) {
    const p = this.get(pid);
    if (!p || p.state === state) return;
    p.state = state;
    if (!p.scripted) p.actor.setAnim(animOf(p.seat, state));
  }

  /** 把角色交給車廂場景操控（走進車門、演小插曲）：先移到走道那一層 */
  hold(pid: string) {
    const p = this.get(pid);
    if (!p) return null;
    p.scripted = true;
    this.standRow.addChild(p.actor.sprite);
    return p.actor;
  }

  /** 操控結束：回到自己的位子坐好（或站好） */
  settle(pid: string) {
    const p = this.get(pid);
    if (!p) return;
    p.scripted = false;
    (isStand(p.seat) ? this.standRow : p.seat[1] === 'A' ? this.backRow : this.frontRow).addChild(p.actor.sprite);
    p.actor.placeAt(seatX(p.seat), seatCellY(p.seat));
    p.actor.setAnim(animOf(p.seat, p.state), viewOf(p.seat));
  }

  /** 下車的人：從名單拿出來，由車廂場景帶到車門口，最後自己淡出 */
  detach(pid: string) {
    const p = this.get(pid);
    if (!p) return null;
    this.list = this.list.filter(x => x !== p);
    this.standRow.addChild(p.actor.sprite);
    this.leaving.push(p.actor);
    return p.actor;
  }

  /** 站著、還沒人讓座的長者與家長 */
  standingSpecials(): Pax[] {
    return this.list.filter(p => isSpecialPax(p) && isStand(p.seat) && !p.scripted);
  }

  /** 拉吊環的人：車廂場景據此畫出吊環 */
  standing(): Pax[] {
    return this.list.filter(p => isStand(p.seat));
  }

  freeSeat(): SeatId | null {
    return pickSeat(this.list.map(p => p.seat));
  }

  /** 離線模式：補一位 NPC */
  boardLocalNpc() {
    const seat = this.freeSeat();
    if (!seat) return;
    this.add({
      pid: `local_${++this.localSeq}`, seat, ...npcIdentity(this.list.map(p => p.actor.look.name)),
      state: PAX_STATES[Math.floor(Math.random() * PAX_STATES.length)], since: Date.now(), npc: true,
    });
  }

  /**
   * 離線模式到站：決定誰下車、誰上車（由車廂場景套用，才能演小插曲）。
   * 長者與家長坐滿幾站下車；大站時偶爾有一位上車（docs/PRD.md 第 20 章）。
   */
  planLocalArrival(bigStation: boolean): Arrival {
    const leave: string[] = [];
    const regular = this.list.filter(p => p.npc && !isSpecialPax(p));
    // 人潮過後：比平常多的人在這站陸續下車
    const crowd = Math.max(0, regular.length - 6);
    regular.filter(() => Math.random() < 0.3).slice(0, 2).forEach(p => leave.push(p.pid));
    regular.filter(p => !leave.includes(p.pid)).sort(() => Math.random() - 0.5).slice(0, crowd).forEach(p => leave.push(p.pid));
    for (const p of this.list.filter(isSpecialPax)) {
      const left = (this.specialLeft.get(p.pid) ?? 1) - 1;
      this.specialLeft.set(p.pid, left);
      if (left <= 0) leave.push(p.pid);
    }
    const staying = this.list.filter(p => !leave.includes(p.pid));
    const taken: SpotId[] = staying.map(p => p.seat);
    const free = (s: SpotId) => !taken.includes(s);
    const moves: Arrival['moves'] = [];
    for (const p of staying.filter(x => isSpecialPax(x) && isStand(x.seat))) {
      const seat = [...PRIORITY_SEATS].find(free);
      if (!seat) continue;
      taken.push(seat);
      moves.push({ pid: p.pid, seat });
    }

    const board: Passenger[] = [];
    const want = 4 + Math.floor(Math.random() * 3) - staying.filter(p => p.npc && !isSpecialPax(p)).length;
    for (let i = 0; i < Math.min(2, want); i++) if (!this.planNpc(board, taken)) break;
    if (bigStation && !staying.some(isSpecialPax) && Math.random() < 0.3) {
      // 大站的人潮：先上來一群人把座位坐滿，長者或家長才會沒位子坐（多出來的人之後陸續下車）
      while (this.planNpc(board, taken));
      this.planSpecial(board, taken);
    }
    return { leave, board, moves };
  }

  /** 一位一般 NPC 坐進空位（先避開博愛座）；沒位子時回傳 false */
  private planNpc(board: Passenger[], taken: SpotId[]) {
    const seat = pickSeat(taken);
    if (!seat) return false;
    taken.push(seat);
    board.push({
      pid: `local_${++this.localSeq}`, seat, ...npcIdentity([...this.list.map(p => p.actor.look.name), ...board.map(b => b.name)]),
      state: PAX_STATES[Math.floor(Math.random() * PAX_STATES.length)], since: Date.now(), npc: true,
    });
    return true;
  }

  /** 離線模式：一位長者或家長上車（開發時也用來直接叫一位上車） */
  planSpecial(board: Passenger[], taken: SpotId[] = this.list.map(p => p.seat)) {
    const free = (s: SpotId) => !taken.includes(s);
    const seat = [...PRIORITY_SEATS].find(free) ?? SPECIAL_STANDS.find(free);
    if (!seat) return;
    const kind = SPECIAL_KINDS[Math.floor(Math.random() * SPECIAL_KINDS.length)];
    const pid = `local_${++this.localSeq}`;
    this.specialLeft.set(pid, 2 + Math.floor(Math.random() * 2));
    taken.push(seat);
    board.push({ pid, seat, ...specialIdentity(kind, this.list.map(p => p.actor.look.name)), state: 'idle', since: Date.now(), npc: true });
  }

  labels(out: Label[]) {
    const self = this.selfPid();
    for (const p of this.list) {
      const { x, y } = p.actor.headTop;
      out.push({ id: p.pid, name: p.actor.look.name, x, y, alpha: p.actor.sprite.alpha, self: p.pid === self });
    }
    for (const a of this.leaving) {
      const { x, y } = a.headTop;
      out.push({ id: `${a.id}~`, name: a.look.name, x, y, alpha: a.sprite.alpha, self: false });
    }
  }

  update(dt: number) {
    for (const p of this.list) {
      p.actor.update(dt, this.frames);
      if (this.autonomous && p.npc && !isSpecialPax(p)) {
        p.nextChange -= dt;
        if (p.nextChange <= 0) {
          p.nextChange = 40 + Math.random() * 90;
          this.setState(p.pid, PAX_STATES[Math.floor(Math.random() * PAX_STATES.length)]);
        }
      }
      if (p.state === 'sleep' && p.actor.sprite.alpha >= 1 && (p.emitTimer -= dt) <= 0) {
        this.particles.emit('zzz', p.actor.sprite.x + 40, p.actor.sprite.y + 6, this.zzzTint());
        p.emitTimer = 2.2;
      }
    }
    for (const a of this.leaving) a.update(dt, this.frames);
    const gone = this.leaving.filter(a => a.gone);
    gone.forEach(a => a.sprite.destroy());
    if (gone.length) this.leaving = this.leaving.filter(a => !gone.includes(a));
  }
}
