// 北城捷運車票明信片（docs/PRD.md §8.1–8.5）
// 公開分享連結只帶這些欄位：全是代碼與數字，不含任何使用者輸入的文字，因此不需內容審核也不需資料庫。
import { LINES } from './lines';
import type { LineId, Mode, PassCardId, SeatId } from './protocol';
import { QUOTES } from './quotes';

export interface TicketStats {
  line: LineId;
  /** 上車站／目前到達站的站碼 */
  from: string;
  to: string;
  seat: SeatId;
  /** 上車時間（epoch ms） */
  boardedAt: number;
  minutes: number;
  pomodoros: number;
  coffee: number;
  cheers: number;
  /** 同車過的真人乘客數（不含 NPC 與自己） */
  coRiders: number;
  /** QUOTES[mode] 的索引 */
  quote: number;
  mode: Mode;
  card: PassCardId;
  /** 車廂編號，例如 CX-0042 */
  room: string;
}

export const PASS_CARDS: Record<PassCardId, { zh: string; en: string }> = {
  tile: { zh: '四色花磚', en: 'TILE' },
  boba: { zh: '像素珍奶', en: 'BOBA' },
  ricecooker: { zh: '像素電鍋', en: 'RICE COOKER' },
  mangoice: { zh: '芒果冰', en: 'MANGO ICE' },
};

export function stationByCode(line: LineId, code: string) {
  return LINES[line].stations.find(s => s.code === code);
}

export function quoteOf(t: Pick<TicketStats, 'mode' | 'quote'>) {
  const list = QUOTES[t.mode];
  return list[((t.quote % list.length) + list.length) % list.length];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 以台北時間（UTC+8）格式化，伺服器與用戶端結果一致 */
export function taipeiParts(ms: number) {
  const d = new Date(ms + 8 * 3_600_000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    wd: '日一二三四五六'[d.getUTCDay()], hh: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()),
  };
}

/** 序號：No. CX0042-3B-1103-2149 */
export function ticketSerial(t: Pick<TicketStats, 'room' | 'seat' | 'boardedAt' | 'minutes'>) {
  const p = taipeiParts(t.boardedAt + t.minutes * 60_000);
  return `${t.room.replace('-', '')}-${t.seat}-${pad(p.mo)}${pad(p.d)}-${p.hh}${p.mm}`;
}

export function companionLine(coRiders: number) {
  return coRiders > 0 ? `和 ${coRiders} 位陌生人安靜地同行了一段路` : '一個人的車廂，也很好';
}

/** 分享文案模板（docs/PRD.md §8.5） */
export function shareText(t: TicketStats, url: string) {
  const line = LINES[t.line];
  return `我在《車廂角落》${line.zh} ${t.seat} 安靜地坐了 ${t.minutes} 分鐘 ☕×${t.coffee}\n「${quoteOf(t)}」\n你也上車吧 → ${url} #車廂角落`;
}
