// 車廂分流（docs/PRD.md §7.4）：先求不冷清，再求低密度，最後才加開車廂
import { HARD_CAP, SOFT_CAP, type LineId } from '@cc/shared';
import type { Config } from '../config';
import { Room, type Emit } from './Room';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private seq = 0;

  constructor(private cfg: Config, private emitTo: (roomId: string) => Emit) {}

  assign(line: LineId): Room {
    const rooms = [...this.rooms.values()].filter(r => r.line.id === line && !r.disposed);

    // ① 未達 8 人的車廂中，挑人最多的 → 讓車廂盡快熱起來
    const cozy = rooms.filter(r => r.realCount < SOFT_CAP).sort((a, b) => b.realCount - a.realCount)[0];
    if (cozy) return cozy;

    // ② 都已達 8 人：挑人最少的未滿車廂 → 開始動用博愛座
    const roomy = rooms.filter(r => r.realCount < HARD_CAP).sort((a, b) => a.realCount - b.realCount)[0];
    if (roomy) return roomy;

    // ③ 全部滿載 → 加開新車廂（建構時由 NPC 補到熱度）
    const id = `${line}-${String(++this.seq).padStart(4, '0')}`;
    const room = new Room(id, line, this.cfg, this.emitTo(id), r => this.rooms.delete(r.id));
    this.rooms.set(id, room);
    return room;
  }

  get(roomId: string | undefined) {
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.realCount;
    return { rooms: this.rooms.size, players };
  }

  disposeAll() {
    for (const r of [...this.rooms.values()]) r.dispose();
  }
}
