// 一節車廂＝一個房間：伺服器權威的座位、NPC 與霧氣留言（docs/PRD.md §7.3–7.4）；列車時鐘由 TrainRun 統一驅動
import { randomUUID } from 'node:crypto';
import {
  CARS, isStand, npcIdentity, PAX_STATES, pickSeat, spotColumn, STANDS,
  type AvatarId, type BoardedSnapshot, type Gender, type Mode, type Passenger,
  type PaxState, type SpotId, type ServerToClient, type WindowNote,
} from '@cc/shared';
import type { Config } from '../config';
import type { TrainRun } from './TrainRun';

export type Emit = <E extends keyof ServerToClient>(event: E, ...args: Parameters<ServerToClient[E]>) => void;

export interface ServerPax extends Passenger {
  sid: string | null;
  awaySince: number | null;
  stateBeforeAway: PaxState | null;
  dnd: boolean;
  lastNoteLeg: number;
}

export interface NoteRec extends WindowNote {
  authorSid: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface Identity { name: string; gender: Gender; avatar: AvatarId }

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** 依台北時間決定留言的晨／夜版本 */
export function taipeiMode(now = Date.now()): Mode {
  const hour = (new Date(now).getUTCHours() + 8) % 24;
  return hour >= 6 && hour < 17 ? 'morning' : 'night';
}

export const publicPax = (p: ServerPax): Passenger => ({
  pid: p.pid, seat: p.seat, name: p.name, gender: p.gender, avatar: p.avatar, state: p.state, since: p.since,
  ...(p.npc ? { npc: true as const } : {}),
});

export class Room {
  readonly pax = new Map<string, ServerPax>();
  private notes = new Map<string, NoteRec>();
  private fidget: ReturnType<typeof setInterval>;
  disposed = false;

  constructor(
    readonly id: string,
    /** 第幾節（1..CARS） */
    readonly car: number,
    readonly run: TrainRun,
    private cfg: Config,
    private emit: Emit,
  ) {
    this.balanceNpcs();
    this.fidget = setInterval(() => this.npcFidget(), 20_000);
  }

  get line() {
    return this.run.line;
  }

  get realCount() {
    let n = 0;
    for (const p of this.pax.values()) if (!p.npc) n++;
    return n;
  }

  snapshotFor(pax: ServerPax, resumeToken: string): BoardedSnapshot {
    return {
      serverTime: Date.now(),
      resumeToken,
      room: { id: this.id, train: this.run.id, line: this.line.id, capacity: 12, car: this.car, cars: CARS },
      you: { pid: pax.pid, seat: pax.seat, name: pax.name },
      train: this.run.train,
      passengers: [...this.pax.values()].map(publicPax),
      notes: [...this.notes.values()].map(({ authorSid: _a, timer: _t, ...note }) => note),
    };
  }

  /** 真人就座；若 12 個位子都滿了，先請一位 NPC 走到隔壁車廂。帶入 moving 時是從別節車廂走過來的同一位乘客 */
  seatHuman(sid: string, who: Identity, moving?: ServerPax): ServerPax {
    let seat: SpotId | null = pickSeat(this.takenSeats());
    if (!seat) {
      const npc = [...this.pax.values()].find(p => p.npc && !isStand(p.seat));
      if (npc) {
        this.pax.delete(npc.pid);
        this.emit('pax:leave', { pid: npc.pid, reason: 'transfer' });
        seat = npc.seat;
      }
    }
    // 座位全滿時站著
    seat ??= STANDS.find(s => this.isFree(s)) ?? null;
    if (!seat) throw new Error(`room ${this.id} is full`);
    const pax: ServerPax = moving
      ? { ...moving, seat }
      : {
          pid: `p_${randomUUID().slice(0, 8)}`, seat, ...who, state: 'idle', since: Date.now(),
          sid, awaySince: null, stateBeforeAway: null, dnd: false, lastNoteLeg: -1,
        };
    this.pax.set(pax.pid, pax);
    return pax;
  }

  /** 真人離開這節車廂（下車或走到隔壁）；回傳離開的乘客 */
  removeHuman(pid: string): ServerPax | null {
    const p = this.pax.get(pid);
    if (!p || p.npc) return null;
    this.pax.delete(pid);
    return p;
  }

  isFree(seat: SpotId) {
    return ![...this.pax.values()].some(p => p.seat === seat);
  }

  /** 換到同一節車廂的空位或站位 */
  moveSeat(pid: string, seat: SpotId): boolean {
    const p = this.pax.get(pid);
    if (!p || p.seat === seat || !this.isFree(seat)) return false;
    p.seat = seat;
    return true;
  }

  /** 斷線：座位保留，他人眼中變成補眠；到站時若已離線超過寬限時間才下車 */
  markAway(pid: string) {
    const p = this.pax.get(pid);
    if (!p || p.npc || p.awaySince) return;
    p.awaySince = Date.now();
    p.stateBeforeAway = p.state;
    this.setState(pid, 'sleep');
  }

  resume(pid: string, sid: string): ServerPax | null {
    const p = this.pax.get(pid);
    if (!p || p.npc || p.sid !== sid || p.awaySince === null) return null;
    p.awaySince = null;
    this.setState(pid, p.stateBeforeAway ?? 'idle');
    p.stateBeforeAway = null;
    return p;
  }

  setState(pid: string, state: PaxState, broadcast = true) {
    const p = this.pax.get(pid);
    if (!p || p.state === state) return;
    p.state = state;
    p.since = Date.now();
    if (broadcast) this.emit('pax:state', { pid, state, since: p.since });
  }

  canWriteNote(pid: string) {
    return this.pax.get(pid)?.lastNoteLeg !== this.run.legNo;
  }

  /** 寫在作者座位對應的車窗；同一扇窗只留最新的一則 */
  addNote(pid: string, authorSid: string, text: string): NoteRec {
    const p = this.pax.get(pid)!;
    p.lastNoteLeg = this.run.legNo;
    const window = spotColumn(p.seat) - 1;
    for (const n of this.notes.values()) if (n.window === window) this.dropNote(n.nid);
    const now = Date.now();
    const ttl = this.cfg.noteTtlSec * 1000;
    const nid = `n_${randomUUID().slice(0, 8)}`;
    const note: NoteRec = {
      nid, window, text, mode: taipeiMode(now), createdAt: now, expiresAt: now + ttl, authorSid,
      timer: setTimeout(() => this.dropNote(nid), ttl),
    };
    this.notes.set(nid, note);
    return note;
  }

  note(nid: string) {
    return this.notes.get(nid);
  }

  /** 管理移除（檢舉達標等）；自然消散由用戶端依 expiresAt 處理，不需廣播 */
  dropNote(nid: string) {
    const n = this.notes.get(nid);
    if (!n) return;
    clearTimeout(n.timer);
    this.notes.delete(nid);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.fidget);
    for (const n of this.notes.values()) clearTimeout(n.timer);
  }

  private takenSeats(): SpotId[] {
    return [...this.pax.values()].map(p => p.seat);
  }

  /** 列車到站：離線超過寬限時間的乘客下車，NPC 上下車 */
  onArrive(station: string) {
    const now = Date.now();
    const leaving: string[] = [];
    for (const p of this.pax.values()) {
      if (!p.npc && p.awaySince !== null && now - p.awaySince >= this.cfg.graceSec * 1000) {
        this.pax.delete(p.pid);
        leaving.push(p.pid);
      }
    }
    const npc = this.balanceNpcs(true);
    this.emit('train:arrive', {
      station,
      doorsOpenMs: this.run.dwellMs,
      leaving,
      npc: { leave: npc.leave, board: npc.board.map(publicPax) },
    });
  }

  onDepart() {
    this.emit('train:depart', { train: this.run.train });
  }

  /**
   * NPC 熱度維持：真人少於 cfg.npcWarmth 時由 NPC 補足；真人變多時 NPC 在到站時讓位。
   * churn=true 時（到站）偶爾讓一位 NPC 換人，呈現人來人往。
   */
  private balanceNpcs(churn = false): { leave: string[]; board: ServerPax[] } {
    const npcs = [...this.pax.values()].filter(p => p.npc);
    const target = Math.max(0, this.cfg.npcWarmth - this.realCount);
    const leave: string[] = [];
    const board: ServerPax[] = [];

    let excess = npcs.length - target;
    if (excess <= 0 && churn && npcs.length > 0 && Math.random() < 0.35) excess = 1;
    for (const p of npcs.sort(() => Math.random() - 0.5).slice(0, Math.max(0, excess))) {
      this.pax.delete(p.pid);
      leave.push(p.pid);
    }
    while ([...this.pax.values()].filter(p => p.npc).length < target) {
      const seat = pickSeat(this.takenSeats());
      if (!seat) break;
      const p: ServerPax = {
        pid: `npc_${randomUUID().slice(0, 6)}`, seat, ...npcIdentity([...this.pax.values()].map(x => x.name)), state: pick(PAX_STATES), since: Date.now(), npc: true,
        sid: null, awaySince: null, stateBeforeAway: null, dnd: true, lastNoteLeg: -1,
      };
      this.pax.set(p.pid, p);
      board.push(p);
    }
    return { leave, board };
  }

  /** NPC 偶爾換個姿勢：戴上耳機、翻書、打個盹 */
  private npcFidget() {
    if (this.run.phase !== 'run' || Math.random() < 0.5) return;
    const npcs = [...this.pax.values()].filter(p => p.npc);
    if (npcs.length === 0) return;
    const p = pick(npcs);
    this.setState(p.pid, pick(PAX_STATES.filter(s => s !== p.state)));
  }
}
