// 車廂分流（docs/PRD.md §7.4）：先求不冷清，再求低密度，最後才加開列車
import { HARD_CAP, SOFT_CAP, type LineId } from '@cc/shared';
import type { Config } from '../config';
import type { Emit, Room } from './Room';
import { TrainRun } from './TrainRun';

export class RoomManager {
  private runs = new Map<string, TrainRun>();
  private seq = 0;

  constructor(private cfg: Config, private emitTo: (roomId: string) => Emit) {}

  assign(line: LineId): Room {
    const cars = [...this.runs.values()]
      .filter(r => r.line.id === line && !r.disposed)
      .flatMap(r => r.cars);

    // ① 未達 8 人的車廂中，挑人最多的 → 讓車廂盡快熱起來
    const cozy = cars.filter(r => r.realCount < SOFT_CAP).sort((a, b) => b.realCount - a.realCount)[0];
    if (cozy) return cozy;

    // ② 都已達 8 人：挑人最少的未滿車廂 → 開始動用博愛座
    const roomy = cars.filter(r => r.realCount < HARD_CAP).sort((a, b) => a.realCount - b.realCount)[0];
    if (roomy) return roomy;

    // ③ 全部滿載 → 加開新列車（每節由 NPC 補到熱度），先坐進中間的車廂
    const id = `${line}-${String(++this.seq).padStart(4, '0')}`;
    const run = new TrainRun(id, line, this.cfg, this.emitTo, r => this.runs.delete(r.id));
    this.runs.set(id, run);
    return run.cars[Math.floor((run.cars.length - 1) / 2)];
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
  }
}
