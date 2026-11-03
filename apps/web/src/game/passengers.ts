// 乘客：連線時由伺服器的 pax:* 事件驅動；離線模式由本機模擬 NPC（docs/PRD.md §7.4）
import { Container, Sprite } from 'pixi.js';
import { pickSeat, type AvatarId, type Passenger, type PaxState, type SeatId } from '@cc/shared';
import { cupAnchor, FRAME_MS, FRAMES, type CharacterFrames, type View } from './characters';
import { seatCellY, seatX } from './layout';
import type { Particles } from './particles';

const AVATARS: AvatarId[] = ['office', 'student', 'hoodie', 'headphone'];
const NPC_STATES: PaxState[] = ['idle', 'coffee', 'music', 'read', 'sleep'];

export interface Pax {
  pid: string;
  seat: SeatId;
  avatar: AvatarId;
  state: PaxState;
  npc: boolean;
  sprite: Sprite;
  /** 目前播放序列中的位置 */
  step: number;
  stepTimer: number;
  /** 各乘客隨機相位，避免全車同步呼吸 */
  phase: number;
  emitTimer: number;
  nextChange: number;
  leaving: boolean;
}

/** 每個狀態的播放序列（atlas 內的 frame 索引）：喝咖啡大部分時間停在呼吸幀 */
function sequence(state: PaxState, step: number): { frame: number; holdMs: number } {
  const base = FRAME_MS[state];
  switch (state) {
    case 'coffee': {
      const seq = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 1];
      return { frame: seq[step % seq.length], holdMs: base };
    }
    case 'read': {
      const s = step % 40;
      return { frame: s === 39 ? 2 : s % 2, holdMs: base };
    }
    default:
      return { frame: step % FRAMES[state].length, holdMs: base };
  }
}

export class Passengers {
  readonly backRow = new Container();
  readonly frontRow = new Container();
  private list: Pax[] = [];
  private frames!: CharacterFrames;
  private localSeq = 0;

  /** autonomous：離線模式下 NPC 自己換姿勢、自己上下車 */
  constructor(
    private particles: Particles,
    private tints: { steam: () => number; zzz: () => number },
    private autonomous: boolean,
  ) {}

  setFrames(frames: CharacterFrames) {
    this.frames = frames;
    for (const p of this.list) this.applyTexture(p);
  }

  get all(): readonly Pax[] {
    return this.list;
  }

  get(pid: string) {
    return this.list.find(p => p.pid === pid && !p.leaving);
  }

  at(seat: SeatId) {
    return this.list.find(p => p.seat === seat && !p.leaving);
  }

  add(p: Passenger, fadeIn = true): Pax {
    const existing = this.get(p.pid);
    if (existing) return existing;
    const sprite = new Sprite();
    sprite.position.set(seatX(p.seat), seatCellY(p.seat));
    sprite.alpha = fadeIn ? 0 : 1;
    const pax: Pax = {
      pid: p.pid, seat: p.seat, avatar: p.avatar, state: p.state, npc: !!p.npc, sprite,
      step: Math.floor(Math.random() * 8), stepTimer: Math.random() * 600,
      phase: Math.random(), emitTimer: Math.random(), nextChange: 40 + Math.random() * 80, leaving: false,
    };
    (p.seat[1] === 'A' ? this.backRow : this.frontRow).addChild(sprite);
    this.list.push(pax);
    this.applyTexture(pax);
    return pax;
  }

  /** 下車：淡出後移除 */
  remove(pid: string) {
    const p = this.get(pid);
    if (p) p.leaving = true;
  }

  /** 重新同步時立即清空 */
  clear() {
    this.list.forEach(p => p.sprite.destroy());
    this.list = [];
  }

  setState(pid: string, state: PaxState) {
    const p = this.get(pid);
    if (!p || p.state === state) return;
    p.state = state;
    p.step = 0;
    p.stepTimer = 0;
    this.applyTexture(p);
  }

  freeSeat(): SeatId | null {
    return pickSeat(this.list.filter(p => !p.leaving).map(p => p.seat));
  }

  /** 離線模式：補一位 NPC */
  boardLocalNpc() {
    const seat = this.freeSeat();
    if (!seat) return;
    this.add({
      pid: `local_${++this.localSeq}`, seat, avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      state: NPC_STATES[Math.floor(Math.random() * NPC_STATES.length)], since: Date.now(), npc: true,
    });
  }

  /** 離線模式到站：部分 NPC 下車、部分上車 */
  shuffleLocalAtStation() {
    const npcs = this.list.filter(p => p.npc && !p.leaving);
    const leaving = npcs.filter(() => Math.random() < 0.3).slice(0, 2);
    leaving.forEach(p => (p.leaving = true));
    const target = 4 + Math.floor(Math.random() * 3);
    const boarding = Math.max(0, target - (npcs.length - leaving.length));
    for (let i = 0; i < Math.min(2, boarding); i++) this.boardLocalNpc();
  }

  update(dt: number) {
    for (const p of this.list) {
      // 上下車：1 秒淡入淡出（之後換成從貫通道走進來的動畫）
      p.sprite.alpha = p.leaving ? Math.max(0, p.sprite.alpha - dt) : Math.min(1, p.sprite.alpha + dt);

      p.stepTimer += dt * 1000;
      const { holdMs } = sequence(p.state, p.step);
      if (p.stepTimer >= holdMs * (0.9 + p.phase * 0.2)) {
        p.stepTimer = 0;
        p.step++;
        this.applyTexture(p);
      }

      if (this.autonomous && p.npc && !p.leaving) {
        p.nextChange -= dt;
        if (p.nextChange <= 0) {
          p.nextChange = 40 + Math.random() * 90;
          this.setState(p.pid, NPC_STATES[Math.floor(Math.random() * NPC_STATES.length)]);
        }
      }
      this.emit(p, dt);
    }
    const gone = this.list.filter(p => p.leaving && p.sprite.alpha <= 0);
    gone.forEach(p => p.sprite.destroy());
    if (gone.length) this.list = this.list.filter(p => !gone.includes(p));
  }

  private emit(p: Pax, dt: number) {
    if (p.leaving || p.sprite.alpha < 1) return;
    p.emitTimer -= dt;
    if (p.emitTimer > 0) return;
    const view: View = p.seat[1] === 'A' ? 'front' : 'back';
    if (p.state === 'coffee') {
      const { frame } = sequence('coffee', p.step);
      const a = cupAnchor(view, frame);
      this.particles.emit('steam', p.sprite.x + a.x + Math.random() * 3, p.sprite.y + a.y - 2, this.tints.steam());
      p.emitTimer = 0.5;
    } else if (p.state === 'sleep') {
      this.particles.emit('zzz', p.sprite.x + 40, p.sprite.y + 6, this.tints.zzz());
      p.emitTimer = 2.2;
    } else {
      p.emitTimer = 1;
    }
  }

  private applyTexture(p: Pax) {
    if (!this.frames) return;
    const view: View = p.seat[1] === 'A' ? 'front' : 'back';
    const { frame } = sequence(p.state, p.step);
    p.sprite.texture = this.frames[p.avatar][view][FRAMES[p.state][frame]];
  }
}
