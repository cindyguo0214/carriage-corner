// 車廂乘客：連線時由伺服器的 pax:* 事件驅動；離線模式由本機模擬 NPC（docs/PRD.md §7.4）
import { Container } from 'pixi.js';
import { isStand, npcIdentity, PAX_STATES, pickSeat, type Passenger, type PaxState, type SeatId, type SpotId } from '@cc/shared';
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
}

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
    const actor = new Actor(p.pid, { name: p.name, gender: p.gender, avatar: p.avatar }, animOf(p.seat, p.state), viewOf(p.seat), seatX(p.seat), seatCellY(p.seat), fadeIn);
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
    p.actor.setAnim(animOf(p.seat, state));
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

  /** 離線模式到站：部分 NPC 下車、部分上車 */
  shuffleLocalAtStation() {
    const npcs = this.list.filter(p => p.npc);
    const leaving = npcs.filter(() => Math.random() < 0.3).slice(0, 2);
    leaving.forEach(p => this.remove(p.pid));
    const target = 4 + Math.floor(Math.random() * 3);
    const boarding = Math.max(0, target - (npcs.length - leaving.length));
    for (let i = 0; i < Math.min(2, boarding); i++) this.boardLocalNpc();
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
      if (this.autonomous && p.npc) {
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
