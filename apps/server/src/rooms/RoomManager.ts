// 車廂分流（docs/PRD.md §7.4、第 19 章）：先求不冷清，再求低密度，最後才加開列車
// 從月台上車時只會坐進「正停在那一站」的列車：現有列車很快會到就等它，否則從這站加開一班。
import { HARD_CAP, LINES, SOFT_CAP, STAND_CAP, type LineId, type PlatformArrival } from '@cc/shared';
import type { Config } from '../config';
import type { Emit, Room } from './Room';
import { TrainRun } from './TrainRun';

/** 過了發車時間仍容許這麼久（網路延遲）；進站前這麼久就算到了（兩邊時鐘的誤差） */
const LATE_MS = 2000;
const EARLY_MS = 300;

/** 預定加開、還沒有人搭上的列車：有人在開門時間內上車才真的開出 */
interface Plan extends PlatformArrival { line: LineId; station: number }

export class RoomManager {
  private runs = new Map<string, TrainRun>();
  private plans = new Map<string, Plan>();
  private seq = 0;

  constructor(private cfg: Config, private emitTo: (roomId: string) => Emit) {}

  /** 斷線重連、或沒有指定車站時：整條線一起分流 */
  assign(line: LineId): Room {
    const cars = [...this.runs.values()]
      .filter(r => r.line.id === line && !r.disposed)
      .flatMap(r => r.cars);
    const room = pickCar(cars);
    if (room) return room;
    // 全部滿載 → 加開新列車（每節由 NPC 補到熱度），先坐進中間的車廂
    const run = this.newRun(line, this.nextId(line));
    return middleCar(run);
  }

  /** 月台上：下一班停靠 station 的列車。等太久就預定從這站加開一班 */
  nextArrival(line: LineId, station: number, now = Date.now()): PlatformArrival | null {
    const n = LINES[line].stations.length;
    if (!Number.isInteger(station) || station < 0 || station >= n) return null;
    const wait = this.cfg.platformWaitSec * 1000;
    // 車門快關的那班就不等了：剩下不到停站時間的四分之一（最多 1.5 秒）
    const closing = Math.min(1500, this.cfg.dwellSec * 250);
    const soonest = [...this.runs.values()]
      .filter(r => r.line.id === line)
      .map(r => r.stopAt(station))
      .filter((a): a is PlatformArrival => !!a && a.departAt - closing > now && a.arriveAt - now <= wait)
      .sort((a, b) => a.arriveAt - b.arriveAt)[0];
    if (soonest) return soonest;

    // 同一站已經預定的那班，大家一起等
    this.dropStalePlans(now);
    const planned = [...this.plans.values()].find(p => p.line === line && p.station === station && p.departAt - closing > now);
    if (planned) return publicPlan(planned);

    const [min, max] = this.cfg.platformLeadSec;
    const arriveAt = now + (min + Math.random() * (max - min)) * 1000;
    const dir: 1 | -1 = station === 0 ? 1 : station === n - 1 ? -1 : Math.random() < 0.5 ? 1 : -1;
    const plan: Plan = { train: this.nextId(line), arriveAt, departAt: arriveAt + this.cfg.dwellSec * 1000, dir, line, station };
    this.plans.set(plan.train, plan);
    return publicPlan(plan);
  }

  /** 從月台走進車門：只有那班車正停在這站、車門開著時才上得去 */
  boardAt(line: LineId, station: number, train: string, now = Date.now()): Room | null {
    const run = this.runs.get(train);
    if (run) {
      const stop = run.stopAt(station);
      if (run.line.id !== line || run.phase !== 'dwell' || !stop || now > stop.departAt + LATE_MS) return null;
      // 這班車的座位都坐滿了：站上車拉吊環（§24.2），不讓人在月台上錯過車
      return pickCar(run.cars) ?? standingCar(run.cars) ?? null;
    }
    const plan = this.plans.get(train);
    if (!plan || plan.line !== line || plan.station !== station) return null;
    if (now < plan.arriveAt - EARLY_MS || now > plan.departAt + LATE_MS) return null;
    this.plans.delete(train);
    return middleCar(this.newRun(line, train, { station, dir: plan.dir, arriveAt: plan.arriveAt }));
  }

  /** roomId 形如 CX-0001/2 */
  get(roomId: string | undefined): Room | undefined {
    if (!roomId) return undefined;
    const [runId, car] = roomId.split('/');
    return this.runs.get(runId)?.carAt(Number(car));
  }

  stats() {
    let players = 0;
    for (const r of this.runs.values()) players += r.realCount;
    return { trains: this.runs.size, players };
  }

  disposeAll() {
    for (const r of [...this.runs.values()]) r.dispose();
    this.plans.clear();
  }

  private nextId(line: LineId) {
    return `${line}-${String(++this.seq).padStart(4, '0')}`;
  }

  private newRun(line: LineId, id: string, start?: ConstructorParameters<typeof TrainRun>[5]) {
    const run = new TrainRun(id, line, this.cfg, this.emitTo, r => this.runs.delete(r.id), start);
    this.runs.set(id, run);
    return run;
  }

  private dropStalePlans(now: number) {
    for (const [id, p] of this.plans) if (now > p.departAt + LATE_MS) this.plans.delete(id);
  }
}

/** ① 未達 8 人的車廂中挑人最多的 → 讓車廂盡快熱起來；② 都已達 8 人：挑人最少的未滿車廂 */
function pickCar(cars: Room[]): Room | undefined {
  const cozy = cars.filter(r => r.realCount < SOFT_CAP).sort((a, b) => b.realCount - a.realCount)[0];
  return cozy ?? cars.filter(r => r.realCount < HARD_CAP).sort((a, b) => a.realCount - b.realCount)[0];
}

/** 座位都滿了：挑還有站位的車廂裡人最少的那節 */
function standingCar(cars: Room[]): Room | undefined {
  return cars.filter(r => r.realCount < STAND_CAP && r.hasRoomForHuman).sort((a, b) => a.realCount - b.realCount)[0];
}

function middleCar(run: TrainRun) {
  return run.cars[Math.floor((run.cars.length - 1) / 2)];
}

const publicPlan = ({ train, arriveAt, departAt, dir }: Plan): PlatformArrival => ({ train, arriveAt, departAt, dir });
