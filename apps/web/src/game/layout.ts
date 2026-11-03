// 車廂座標（基準解析度 640 × 360，docs/PRD.md §2.1、§2.5）
import type { SeatId } from '@cc/shared';

export const W = 640;
export const H = 360;
/** 直式基準解析度 */
export const PW = 360;
export const PH = 640;
/** 直式畫布最窄寬度：更窄的螢幕改以 1 倍顯示，寬度跟著螢幕走 */
export const MIN_PW = 240;
/** 直式時，640×360 的車廂裁切畫面在 360×640 畫布中的垂直位置 */
export const PORTRAIT_WORLD_Y = 96;

export const SEAT_X0 = 128;
export const SEAT_W = 64;
export const WIN = { y: 56, w: 56, h: 72, inset: 4 } as const;
/** 車窗後方景觀帶 */
export const SCENE_Y = 44;
export const SCENE_H = 96;
export const CEIL_H = 34;
export const FLOOR_Y = 176;
export const A_CELL_Y = 112;
export const B_CELL_Y = 266;
export const B_PANEL_Y = 316;
export const POLES = [112, 527] as const;
export const DOORS = [{ x: 24, w: 76 }, { x: 540, w: 76 }] as const;
export const STRAP_Y = 38;
export const STRAP_XS = Array.from({ length: 14 }, (_, i) => 108 + i * 32);

export const seatNum = (seat: SeatId) => Number(seat[0]);
export const seatX = (seat: SeatId) => SEAT_X0 + (seatNum(seat) - 1) * SEAT_W;
export const seatCellY = (seat: SeatId) => (seat[1] === 'A' ? A_CELL_Y : B_CELL_Y);

export function windowRect(i: number) {
  return { x: SEAT_X0 + i * SEAT_W + WIN.inset, y: WIN.y, w: WIN.w, h: WIN.h };
}

/** 玩家座位對應的車窗：A 排在身後，B 排看向對面同號的窗 */
export const windowForSeat = (seat: SeatId) => seatNum(seat) - 1;
