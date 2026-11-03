// 列車時鐘：依「這一段從何時出發、何時抵達」推算速度與位置（docs/PRD.md §7.3）
// 連線時每一段由伺服器的 train:depart 提供；離線模式則自行排下一段。
import {
  LINES, landmarksBetween, segmentBetween, stationIsUnderground,
  type LandmarkId, type LineDef, type LineId, type Segment, type TrainSnapshot,
} from '@cc/shared';

export type Phase = 'run' | 'dwell';

export interface TrainEvents {
  /** 減速前：到站廣播 */
  announce(next: number): void;
  arrive(station: number): void;
  /** 關門前約 2 秒：關門警示音 */
  doorChime(): void;
  depart(from: number, to: number): void;
}

/** 一段行程，時間皆為本機毫秒（已扣除與伺服器的時鐘差） */
export interface Leg {
  from: number;
  to: number;
  departAt: number;
  arriveAt: number;
  dwellMs: number;
}

/** 全速時近景每秒位移（px） */
export const NEAR_PX = 240;
const ACCEL_SEC = 8;
const DECEL_SEC = 10;
const TABLE_STEP = 1 / 30;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function legFromSnapshot(line: LineDef, s: TrainSnapshot, offsetMs: number): Leg {
  const index = (code: string) => Math.max(0, line.stations.findIndex(st => st.code === code));
  return {
    from: index(s.from),
    to: index(s.to),
    departAt: s.departAt - offsetMs,
    arriveAt: s.arriveAt - offsetMs,
    dwellMs: s.dwellMs,
  };
}

export class Train {
  readonly line: LineDef;
  leg!: Leg;
  phase: Phase = 'run';
  speed = 0;
  accel = 0;
  /** 本段已行駛距離（近景 px） */
  dist = 0;
  /** 本段總距離（近景 px） */
  runDist = 0;
  private table = new Float32Array(1);
  private fired = { announce: true, arrive: true, chime: true };

  /** auto 不為 null 時是離線模式：停站結束後自行出發 */
  constructor(lineId: LineId, private events: TrainEvents, private auto: { runSec: number } | null) {
    this.line = LINES[lineId];
  }

  get from() { return this.leg.from; }
  get to() { return this.leg.to; }
  get dir(): 1 | -1 { return this.leg.to > this.leg.from ? 1 : -1; }
  get runSec() { return (this.leg.arriveAt - this.leg.departAt) / 1000; }

  get segment(): Segment {
    if (this.phase === 'dwell') return stationIsUnderground(this.line, this.to) ? 'underground' : 'elevated';
    return segmentBetween(this.line, this.from, this.to);
  }

  /** 此刻車窗外是不是隧道：出入隧道區段在行駛到一半時切換 */
  get inTunnel(): boolean {
    if (this.phase === 'dwell') return stationIsUnderground(this.line, this.to);
    const p = this.dist / Math.max(1, this.runDist);
    switch (this.segment) {
      case 'underground': return true;
      case 'elevated': return false;
      case 'portal_up': return p < 0.5;
      case 'portal_down': return p >= 0.5;
    }
  }

  get landmarks(): LandmarkId[] {
    return landmarksBetween(this.line, this.from, this.to);
  }

  stationUnderground(index: number) {
    return stationIsUnderground(this.line, index);
  }

  /** 換上新的一段；中途加入時，已經過去的事件不補發 */
  setLeg(leg: Leg, now: number, isDeparture: boolean) {
    this.leg = leg;
    const run = this.runSec;
    const steps = Math.ceil(run / TABLE_STEP) + 1;
    this.table = new Float32Array(steps);
    for (let i = 1; i < steps; i++) {
      this.table[i] = this.table[i - 1] + this.speedAt((i - 1) * TABLE_STEP, run) * NEAR_PX * TABLE_STEP;
    }
    this.runDist = this.table[steps - 1];
    const t = (now - leg.departAt) / 1000;
    this.fired = {
      announce: t >= run - DECEL_SEC - 3,
      arrive: t >= run,
      chime: t >= run + (leg.dwellMs - 2200) / 1000,
    };
    if (isDeparture) this.events.depart(leg.from, leg.to);
    this.sample(now);
  }

  update(dt: number, now: number) {
    const prev = this.speed;
    this.sample(now);
    const run = this.runSec;
    const t = (now - this.leg.departAt) / 1000;

    if (!this.fired.announce && t >= run - DECEL_SEC - 3) {
      this.fired.announce = true;
      this.events.announce(this.to);
    }
    if (!this.fired.arrive && t >= run) {
      this.fired.arrive = true;
      this.events.arrive(this.to);
    }
    const dwellT = (t - run) * 1000;
    if (!this.fired.chime && dwellT >= this.leg.dwellMs - 2200) {
      this.fired.chime = true;
      this.events.doorChime();
    }
    // 連線模式：停站結束後等伺服器的 train:depart；離線模式自己出發
    if (this.auto && dwellT >= this.leg.dwellMs) this.departLocally(now);

    this.accel = dt > 0 ? (this.speed - prev) / dt : 0;
  }

  /** 離線模式的第一段：從行駛途中開始 */
  startLocal(now: number, dwellMs: number) {
    const n = this.line.stations.length;
    const from = Math.floor(Math.random() * (n - 1));
    const runMs = this.auto!.runSec * 1000;
    const departAt = now - runMs * 0.3;
    this.setLeg({ from, to: from + 1, departAt, arriveAt: departAt + runMs, dwellMs }, now, false);
  }

  /** 離線模式：剛停進 station 這一站（從月台上車時），停站結束後往 toward（終點站索引）開 */
  startAtStation(station: number, toward: number, now: number, dwellMs: number, elapsedMs = 800) {
    const n = this.line.stations.length;
    const out = toward > station ? 1 : -1;
    // 進站方向：一般站與出站同向；終點站是從另一邊開進來再折返
    const dir = station === 0 || station === n - 1 ? -out : out;
    const runMs = this.auto!.runSec * 1000;
    const arriveAt = now - elapsedMs;
    this.setLeg({ from: station - dir, to: station, departAt: arriveAt - runMs, arriveAt, dwellMs }, now, false);
  }

  /** 停站時剩下的開門毫秒數；行駛中為 0 */
  dwellLeft(now: number) {
    return this.phase === 'dwell' ? Math.max(0, this.leg.arriveAt + this.leg.dwellMs - now) : 0;
  }

  private departLocally(now: number) {
    const n = this.line.stations.length;
    const from = this.to;
    let dir = this.dir;
    if (from + dir < 0 || from + dir >= n) dir = dir === 1 ? -1 : 1; // 終點站折返
    const runMs = this.auto!.runSec * 1000;
    this.setLeg({ from, to: from + dir, departAt: now, arriveAt: now + runMs, dwellMs: this.leg.dwellMs }, now, true);
  }

  private sample(now: number) {
    const run = this.runSec;
    const t = (now - this.leg.departAt) / 1000;
    if (t < run) {
      this.phase = 'run';
      this.speed = this.speedAt(Math.max(0, t), run);
      const i = Math.max(0, t) / TABLE_STEP;
      const lo = Math.min(this.table.length - 1, Math.floor(i));
      const hi = Math.min(this.table.length - 1, lo + 1);
      this.dist = this.table[lo] + (this.table[hi] - this.table[lo]) * (i - Math.floor(i));
    } else {
      this.phase = 'dwell';
      this.speed = 0;
      this.dist = this.runDist;
    }
  }

  private speedAt(t: number, run: number) {
    return Math.min(smooth(t / ACCEL_SEC), smooth((run - t) / DECEL_SEC));
  }
}
