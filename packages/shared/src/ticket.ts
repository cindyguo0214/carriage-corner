// 北城捷運車票明信片（docs/PRD.md §8.1–8.5）
// 公開分享連結只帶這些欄位：全是代碼與數字，不含任何使用者輸入的文字，因此不需內容審核也不需資料庫。
import { LINES } from './lines';
import type { Gender, GlowKind, LineId, Mode, PassCardId, SpecialKind, SpotId } from './protocol';
import { QUOTES } from './quotes';

export interface TicketStats {
  line: LineId;
  /** 上車站／目前到達站的站碼 */
  from: string;
  to: string;
  /** 座位，或 S1..S6 站位 */
  seat: SpotId;
  /** 上車時間（epoch ms） */
  boardedAt: number;
  minutes: number;
  pomodoros: number;
  /** 收到的四種互動次數（嗶卡默契、同頻波紋、蓋上小毯、遞幸運籤） */
  received: Record<GlowKind, number>;
  /** 最近收到的一支籤（FORTUNES 索引）；沒收到為 null */
  fortune: number | null;
  /** 這趟讓座的次數，與最近一次讓給誰（docs/PRD.md 第 20 章） */
  yielded: number;
  yieldedTo: YieldTo | null;
  /** 同車過的真人乘客數（不含 NPC 與自己） */
  coRiders: number;
  /** QUOTES[mode] 的索引 */
  quote: number;
  mode: Mode;
  card: PassCardId;
  /** 列車編號，例如 CX-0042 */
  room: string;
}

export type YieldTo = 'grandma' | 'grandpa' | 'mom' | 'dad';
export const YIELD_TO: YieldTo[] = ['grandma', 'grandpa', 'mom', 'dad'];
const YIELD_LABEL: Record<YieldTo, string> = { grandma: '阿嬤', grandpa: '阿公', mom: '帶小孩的媽媽', dad: '帶小孩的爸爸' };

export function yieldTarget(kind: SpecialKind, gender: Gender): YieldTo {
  if (kind === 'elder') return gender === 'f' ? 'grandma' : 'grandpa';
  return gender === 'f' ? 'mom' : 'dad';
}

/** 車票上的「今日成就」；沒讓座時為 null */
export function kindnessLine(t: Pick<TicketStats, 'line' | 'yielded' | 'yieldedTo'>) {
  if (t.yielded <= 0) return null;
  const line = LINES[t.line].zh;
  if (t.yielded > 1 || !t.yieldedTo) return `今日成就：在${line}讓了 ${t.yielded} 次座，心情很暖。`;
  return `今日成就：在${line}給${YIELD_LABEL[t.yieldedTo]}讓了座，心情很暖。`;
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
  return `我在《車廂角落》${line.zh} ${t.seat} 安靜地坐了 ${t.minutes} 分鐘\n「${quoteOf(t)}」\n你也上車吧 → ${url} #車廂角落`;
}
