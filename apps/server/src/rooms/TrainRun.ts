// 一列車：共用同一個列車時鐘的 CARS 節車廂（docs/PRD.md §7.3）。到站、發車由列車統一驅動，各節車廂各自處理乘客。
import { CARS, LINES, segmentBetween, type LineDef, type LineId, type PlatformArrival, type TrainSnapshot } from '@cc/shared';
import type { Config } from '../config';
import { Room, type Emit } from './Room';

interface Leg { from: number; to: number; departAt: number; arriveAt: number }

/** 從某站加開：在 arriveAt 停靠 station，離站後往 dir 方向開 */
export interface TrainStart { station: number; dir: 1 | -1; arriveAt: number }

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
    start?: TrainStart,
  ) {
    this.line = LINES[lineId];
    const n = this.line.stations.length;
    const runMs = this.randomRunMs();
    if (start) {
      // 從上一站開過來；終點站則是從另一側進站、停妥後折返
      const prev = start.station - start.dir;
      const from = prev >= 0 && prev < n ? prev : start.station + start.dir;
      this.leg = { from, to: start.station, departAt: start.arriveAt - runMs, arriveAt: start.arriveAt };
    } else {
      // 斷線重連時的分流：從行駛途中開始，玩家一上車就看到窗外在動
      const from = Math.floor(Math.random() * (n - 1));
      const departAt = Date.now() - runMs * 0.3;
      this.leg = { from, to: from + 1, departAt, arriveAt: departAt + runMs };
    }
    this.cars = Array.from({ length: CARS }, (_, i) => {
      const roomId = `${id}/${i + 1}`;
      return new Room(roomId, i + 1, this, cfg, emitTo(roomId));
    });
    this.scheduleArrival();
  }

  /** 離開目前這段的終點站之後往哪個方向（終點站折返） */
  get nextDir(): 1 | -1 {
    const dir = this.leg.to > this.leg.from ? 1 : -1;
    const next = this.leg.to + dir;
    return next < 0 || next >= this.line.stations.length ? (-dir as 1 | -1) : dir;
  }

  /**
   * 這班車接下來會不會停靠 station：正停在這站、或正開往這站。
   * 再下一站以後的時間要等發車才決定（每段行駛時間隨機），所以不算。
   */
  stopAt(station: number): PlatformArrival | null {
    if (this.disposed || this.leg.to !== station) return null;
    return { train: this.id, arriveAt: this.leg.arriveAt, departAt: this.leg.arriveAt + this.dwellMs, dir: this.nextDir };
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
    // 加開列車在進站時刻之後才開出：當場就停在月台、車門開著
    if (this.leg.arriveAt <= Date.now()) return this.arrive();
    this.timer = setTimeout(() => this.arrive(), this.leg.arriveAt - Date.now());
  }

  private arrive() {
    this.phase = 'dwell';
    this.cars.forEach(c => c.onArrive(this.stationCode));
    if (this.realCount === 0) {
      if (++this.emptyStations >= 3) return this.dispose();
    } else {
      this.emptyStations = 0;
    }
    this.timer = setTimeout(() => this.depart(), Math.max(0, this.leg.arriveAt + this.dwellMs - Date.now()));
  }

  private depart() {
    const from = this.leg.to;
    const dir = this.nextDir;
    const now = Date.now();
    this.leg = { from, to: from + dir, departAt: now, arriveAt: now + this.randomRunMs() };
    this.legNo++;
    this.phase = 'run';
    this.cars.forEach(c => c.onDepart());
    this.scheduleArrival();
  }
}
