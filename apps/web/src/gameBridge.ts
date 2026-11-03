// HUD 與遊戲場景之間的薄介面：HUD 不需要靜態載入整個 Pixi 場景模組
import type { AckCode, GlowKind, SeatId, TicketStats } from '@cc/shared';

export type NoteResult = { ok: true } | { ok: false; code: AckCode | 'NETWORK' };

export interface GameApi {
  writeNote(text: string): Promise<NoteResult>;
  glow(seat: SeatId, kind: GlowKind): Promise<void>;
  /** 擦掉：只有自己看不到 */
  wipeNote(window: number): void;
  reportNote(window: number): Promise<void>;
  /** 車票用：此刻抵達（或剛離開）的站 */
  currentStation(): number;
  /** 連線時可取得簽章分享連結；離線回傳 null */
  signTicket(stats: TicketStats): Promise<string | null>;
}

export const bridge: { game: GameApi | null } = { game: null };
