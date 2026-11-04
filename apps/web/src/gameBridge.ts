// HUD 與遊戲場景之間的薄介面：HUD 不需要靜態載入整個 Pixi 場景模組
import type { AckCode, GlowKind, SpotId, TicketStats } from '@cc/shared';

export type NoteResult = { ok: true } | { ok: false; code: AckCode | 'NETWORK' };

/** 月台輪盤的四個互動（docs/PRD.md §23.2）：月台沒有蓋小毯，多了打招呼 */
export type PlatformGlow = 'hi' | 'beep' | 'wave' | 'fortune';

export interface GameApi {
  writeNote(text: string): Promise<NoteResult>;
  glow(seat: SpotId, kind: GlowKind): Promise<void>;
  /** 擦掉：只有自己看不到 */
  wipeNote(window: number): void;
  reportNote(window: number): Promise<void>;
  /** 車票用：此刻抵達（或剛離開）的站；在月台上就是月台那一站 */
  currentStation(): number;
  /** 下車（車門開著時） */
  alight(): void;
  /** 走到相鄰車廂 */
  moveCar(dir: -1 | 1): void;
  /** 月台上對候車乘客的互動（本機效果） */
  platformGlow(npc: string, kind: PlatformGlow): void;
  /** 自己頭上浮出一個小圖示，持續 ms 毫秒 */
  popSelf(text: string, ms?: number): void;
  /** 連線時可取得簽章分享連結；離線回傳 null */
  signTicket(stats: TicketStats): Promise<string | null>;
}

export const bridge: { game: GameApi | null } = { game: null };
