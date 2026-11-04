import { PRIORITY_SEATS, SEATS, type SeatId, type SpotId } from './protocol';

/** 舒適分流線：一節車廂的真人到 8 人就開始分流，大家都能隔一個位子坐（docs/PRD.md §24.2） */
export const SOFT_CAP = 8;
/** 座位上限：12 個實體座位（含 4 個博愛座）坐滿，座位區就飽和；分流與加開新車以這條線為準 */
export const HARD_CAP = 12;
/** 站立上限：座位滿了之後，走道上還有 S1～S6 六個拉吊環的站位（從月台搭上這班車、或走到隔壁車廂時用） */
export const STAND_CAP = HARD_CAP + 6;

const seatDistance = (a: SeatId, b: SeatId) => (a[1] !== b[1] ? 3 : Math.abs(Number(a[0]) - Number(b[0])));
const isSeat = (s: SpotId): s is SeatId => s[0] !== 'S';

/** 台北式就座：先避開博愛座，再盡量和別人隔一個位子；對面長椅不算「坐旁邊」（docs/PRD.md §7.4） */
export function pickSeat(taken: Iterable<SpotId>, random: () => number = Math.random): SeatId | null {
  // 站著的人不影響選座位
  const occupied = new Set([...taken].filter(isSeat));
  const free = SEATS.filter(s => !occupied.has(s));
  if (free.length === 0) return null;
  const regular = free.filter(s => !PRIORITY_SEATS.has(s));
  const pool = regular.length > 0 ? regular : free;
  const score = (s: SeatId) => Math.min(Infinity, ...[...occupied].map(t => seatDistance(s, t)));
  const best = Math.max(...pool.map(score));
  const candidates = pool.filter(s => score(s) === best);
  return candidates[Math.floor(random() * candidates.length)];
}
