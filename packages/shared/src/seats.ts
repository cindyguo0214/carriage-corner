import { PRIORITY_SEATS, SEATS, type SeatId } from './protocol';

/** 理想密度：一般座 8 個 */
export const SOFT_CAP = 8;
/** 絕對上限：含博愛座 12 個 */
export const HARD_CAP = 12;

const seatDistance = (a: SeatId, b: SeatId) => (a[1] !== b[1] ? 3 : Math.abs(Number(a[0]) - Number(b[0])));

/** 台北式就座：先避開博愛座，再盡量和別人隔一個位子；對面長椅不算「坐旁邊」（docs/PRD.md §7.4） */
export function pickSeat(taken: Iterable<SeatId>, random: () => number = Math.random): SeatId | null {
  const occupied = new Set(taken);
  const free = SEATS.filter(s => !occupied.has(s));
  if (free.length === 0) return null;
  const regular = free.filter(s => !PRIORITY_SEATS.has(s));
  const pool = regular.length > 0 ? regular : free;
  const score = (s: SeatId) => Math.min(Infinity, ...[...occupied].map(t => seatDistance(s, t)));
  const best = Math.max(...pool.map(score));
  const candidates = pool.filter(s => score(s) === best);
  return candidates[Math.floor(random() * candidates.length)];
}
