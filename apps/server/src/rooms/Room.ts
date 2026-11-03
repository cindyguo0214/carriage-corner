// 一節車廂＝一個房間：伺服器權威的座位、列車時鐘、NPC 與霧氣留言（docs/PRD.md §7.3–7.4）
import { randomUUID } from 'node:crypto';
import {
  LINES, pickSeat, segmentBetween,
  type AvatarId, type BoardedSnapshot, type LineDef, type LineId, type Mode, type Passenger,
  type PaxState, type SeatId, type ServerToClient, type TrainSnapshot, type WindowNote,
} from '@cc/shared';
import type { Config } from '../config';

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

interface Leg { from: number; to: number; departAt: number; arriveAt: number }

const AVATARS: AvatarId[] = ['office', 'student', 'hoodie', 'headphone'];
const STATES: PaxState[] = ['idle', 'coffee', 'music', 'read', 'sleep'];
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** 依台北時間決定留言的晨／夜版本 */
export function taipeiMode(now = Date.now()): Mode {
  const hour = (new Date(now).getUTCHours() + 8) % 24;
  return hour >= 6 && hour < 17 ? 'morning' : 'night';
}

export const publicPax = (p: ServerPax): Passenger => ({
  pid: p.pid, seat: p.seat, avatar: p.avatar, state: p.state, since: p.since, ...(p.npc ? { npc: true as const } : {}),
});

export class Room {
  readonly line: LineDef;
  readonly pax = new Map<string, ServerPax>();
  private notes = new Map<string, NoteRec>();
  private leg: Leg;
  private legNo = 0;
  private phase: 'run' | 'dwell' = 'run';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private fidget: ReturnType<typeof setInterval>;
  private emptyStations = 0;
  disposed = false;

  constructor(
    readonly id: string,
    lineId: LineId,
    private cfg: Config,
    private emit: Emit,
    private onDispose: (room: Room) => void,
  ) {
    this.line = LINES[lineId];
    const n = this.line.stations.length;
    const from = Math.floor(Math.random() * (n - 1));
    const runMs = this.randomRunMs();
    // 新車廂從行駛途中開始，玩家一上車就看到窗外在動
    const departAt = Date.now() - runMs * 0.3;
    this.leg = { from, to: from + 1, departAt, arriveAt: departAt + runMs };
    this.scheduleArrival();
    this.balanceNpcs();
    this.fidget = setInterval(() => this.npcFidget(), 20_000);
  }

  get realCount() {
    let n = 0;
    for (const p of this.pax.values()) if (!p.npc) n++;
    return n;
  }

  get dwellMs() {
    return this.cfg.dwellSec * 1000;
  }

  get train(): TrainSnapshot {
    const { stations } = this.line;
    const dir = this.leg.to > this.leg.from ? 1 : -1;
    return {
      dir: `toward:${stations[dir === 1 ? stations.length - 1 : 0].code}`,
      from: stations[this.leg.from].code,
      to: stations[this.leg.to].code,
      departAt: this.leg.departAt,
      arriveAt: this.leg.arriveAt,
      dwellMs: this.dwellMs,
      segment: segmentBetween(this.line, this.leg.from, this.leg.to),
    };
  }

  snapshotFor(pax: ServerPax, resumeToken: string): BoardedSnapshot {
    return {
      serverTime: Date.now(),
      resumeToken,
      room: { id: this.id, line: this.line.id, capacity: 12 },
      you: { pid: pax.pid, seat: pax.seat, codename: `Seat ${pax.seat}` },
      train: this.train,
      passengers: [...this.pax.values()].map(publicPax),
      notes: [...this.notes.values()].map(({ authorSid: _a, timer: _t, ...note }) => note),
    };
  }

  /** 真人就座；若 12 個位子都滿了，先請一位 NPC 走到隔壁車廂 */
  seatHuman(sid: string, avatar: AvatarId): ServerPax {
    let seat = pickSeat(this.takenSeats());
    if (!seat) {
      const npc = [...this.pax.values()].find(p => p.npc);
      if (npc) {
        this.pax.delete(npc.pid);
        this.emit('pax:leave', { pid: npc.pid, reason: 'transfer' });
        seat = npc.seat;
      }
    }
    if (!seat) throw new Error(`room ${this.id} is full`);
    const pax: ServerPax = {
      pid: `p_${randomUUID().slice(0, 8)}`, seat, avatar, state: 'idle', since: Date.now(),
      sid, awaySince: null, stateBeforeAway: null, dnd: false, lastNoteLeg: -1,
    };
    this.pax.set(pax.pid, pax);
    return pax;
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
    return this.pax.get(pid)?.lastNoteLeg !== this.legNo;
  }

  /** 寫在作者座位對應的車窗；同一扇窗只留最新的一則 */
  addNote(pid: string, authorSid: string, text: string): NoteRec {
    const p = this.pax.get(pid)!;
    p.lastNoteLeg = this.legNo;
    const window = Number(p.seat[0]) - 1;
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
    clearTimeout(this.timer);
    clearInterval(this.fidget);
    for (const n of this.notes.values()) clearTimeout(n.timer);
    this.onDispose(this);
  }

  private takenSeats(): SeatId[] {
    return [...this.pax.values()].map(p => p.seat);
  }

  private randomRunMs() {
    const [min, max] = this.cfg.runSec;
    return (min + Math.random() * (max - min)) * 1000;
  }

  private scheduleArrival() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.arrive(), Math.max(0, this.leg.arriveAt - Date.now()));
  }

  private arrive() {
    this.phase = 'dwell';
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
      station: this.line.stations[this.leg.to].code,
      doorsOpenMs: this.dwellMs,
      leaving,
      npc: { leave: npc.leave, board: npc.board.map(publicPax) },
    });

    if (this.realCount === 0) {
      if (++this.emptyStations >= 3) return this.dispose();
    } else {
      this.emptyStations = 0;
    }
    this.timer = setTimeout(() => this.depart(), this.dwellMs);
  }

  private depart() {
    const n = this.line.stations.length;
    const from = this.leg.to;
    let dir = this.leg.to > this.leg.from ? 1 : -1;
    if (from + dir < 0 || from + dir >= n) dir = -dir; // 終點站折返
    const now = Date.now();
    this.leg = { from, to: from + dir, departAt: now, arriveAt: now + this.randomRunMs() };
    this.legNo++;
    this.phase = 'run';
    this.emit('train:depart', { train: this.train });
    this.scheduleArrival();
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
        pid: `npc_${randomUUID().slice(0, 6)}`, seat, avatar: pick(AVATARS), state: pick(STATES), since: Date.now(), npc: true,
        sid: null, awaySince: null, stateBeforeAway: null, dnd: true, lastNoteLeg: -1,
      };
      this.pax.set(p.pid, p);
      board.push(p);
    }
    return { leave, board };
  }

  /** NPC 偶爾換個姿勢：喝口咖啡、翻書、打個盹 */
  private npcFidget() {
    if (this.phase !== 'run' || Math.random() < 0.5) return;
    const npcs = [...this.pax.values()].filter(p => p.npc);
    if (npcs.length === 0) return;
    const p = pick(npcs);
    this.setState(p.pid, pick(STATES.filter(s => s !== p.state)));
  }
}
