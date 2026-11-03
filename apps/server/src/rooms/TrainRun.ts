// 一列車：共用同一個列車時鐘的 CARS 節車廂（docs/PRD.md §7.3）。到站、發車由列車統一驅動，各節車廂各自處理乘客。
import { CARS, LINES, segmentBetween, type LineDef, type LineId, type TrainSnapshot } from '@cc/shared';
import type { Config } from '../config';
import { Room, type Emit } from './Room';

interface Leg { from: number; to: number; departAt: number; arriveAt: number }

export class TrainRun {
  readonly line: LineDef;
  readonly cars: Room[];
  legNo = 0;
  phase: 'run' | 'dwell' = 'run';
  disposed = false;
  private leg: Leg;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private emptyStations = 0;

  constructor(
    /** 例如 CX-0001（車票上的列車編號） */
    readonly id: string,
    lineId: LineId,
    private cfg: Config,
    emitTo: (roomId: string) => Emit,
    private onDispose: (run: TrainRun) => void,
  ) {
    this.line = LINES[lineId];
    const n = this.line.stations.length;
    const from = Math.floor(Math.random() * (n - 1));
    const runMs = this.randomRunMs();
    // 新列車從行駛途中開始，玩家一上車就看到窗外在動
    const departAt = Date.now() - runMs * 0.3;
    this.leg = { from, to: from + 1, departAt, arriveAt: departAt + runMs };
    this.cars = Array.from({ length: CARS }, (_, i) => {
      const roomId = `${id}/${i + 1}`;
      return new Room(roomId, i + 1, this, cfg, emitTo(roomId));
    });
    this.scheduleArrival();
  }

  get realCount() {
    return this.cars.reduce((n, c) => n + c.realCount, 0);
  }

  get dwellMs() {
    return this.cfg.dwellSec * 1000;
  }

  get stationCode() {
    return this.line.stations[this.leg.to].code;
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

  /** 相鄰車廂；超出第 1 節或最後一節時為 undefined */
  carAt(car: number) {
    return this.cars[car - 1];
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.cars.forEach(c => c.dispose());
    this.onDispose(this);
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
    this.cars.forEach(c => c.onArrive(this.stationCode));
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
    this.cars.forEach(c => c.onDepart());
    this.scheduleArrival();
  }
}
