// 北城捷運 TPRT 虛構路網。所有路線、站名、站碼與地標皆為原創（見 docs/PRD.md 第 3 章）。
import type { LineId, Segment } from './protocol';

export type LandmarkId = 'city_tower' | 'red_pillar_hotel' | 'river' | 'far_mountain' | 'lake' | 'runway';

export interface Station {
  code: string;
  zh: string;
  en: string;
  /** 往下一站（索引 +1）方向的區段類型；終點站的值不使用 */
  segmentToNext: Segment;
  landmarks?: LandmarkId[];
  transfer?: LineId[];
}

export interface LineDef {
  id: LineId;
  zh: string;
  en: string;
  color: string;
  seatColor: 'blue' | 'yellow';
  stations: Station[];
}

export const OPERATOR = { zh: '北城捷運', en: 'TPRT' } as const;

export const LINES: Record<LineId, LineDef> = {
  CX: {
    id: 'CX',
    zh: '城心線',
    en: 'City Core Line',
    color: '#7C93A8',
    seatColor: 'blue',
    stations: [
      { code: 'CX01', zh: '西城口', en: 'West Gate', segmentToNext: 'underground' },
      { code: 'CX02', zh: '茶行街', en: 'Tea House St.', segmentToNext: 'underground' },
      { code: 'CX03', zh: '中央站', en: 'Central', segmentToNext: 'underground', transfer: ['RV'] },
      { code: 'CX04', zh: '書肆巷', en: 'Shusi Lane', segmentToNext: 'underground' },
      { code: 'CX05', zh: '榕樹下', en: 'Banyan Shade', segmentToNext: 'underground' },
      { code: 'CX06', zh: '東城', en: 'East Town', segmentToNext: 'underground' },
      { code: 'CX07', zh: '展覽館', en: 'Expo Hall', segmentToNext: 'underground', transfer: ['SK'] },
    ],
  },
  RV: {
    id: 'RV',
    zh: '河岸線',
    en: 'Riverside Line',
    color: '#B97A6F',
    seatColor: 'yellow',
    stations: [
      { code: 'RV01', zh: '中央站', en: 'Central', segmentToNext: 'underground', transfer: ['CX'] },
      { code: 'RV02', zh: '老城', en: 'Old Town', segmentToNext: 'portal_up' },
      { code: 'RV03', zh: '紅柱山', en: 'Hongzhu Hill', segmentToNext: 'elevated', landmarks: ['red_pillar_hotel'] },
      { code: 'RV04', zh: '芝蘭', en: 'Zhilan', segmentToNext: 'elevated', landmarks: ['red_pillar_hotel', 'river'] },
      { code: 'RV05', zh: '溫泉谷', en: 'Hot Spring Valley', segmentToNext: 'elevated', landmarks: ['far_mountain'] },
      { code: 'RV06', zh: '渡口', en: 'Ferry Pier', segmentToNext: 'elevated', landmarks: ['river', 'far_mountain'] },
      { code: 'RV07', zh: '夕照', en: 'Sunset Point', segmentToNext: 'elevated', landmarks: ['river', 'far_mountain'] },
    ],
  },
  SK: {
    id: 'SK',
    zh: '雲橋線',
    en: 'Skybridge Line',
    color: '#A89170',
    seatColor: 'blue',
    stations: [
      { code: 'SK01', zh: '茶山', en: 'Tea Hill', segmentToNext: 'elevated', landmarks: ['far_mountain'] },
      { code: 'SK02', zh: '科技橋', en: 'Tech Bridge', segmentToNext: 'elevated', landmarks: ['city_tower'] },
      { code: 'SK03', zh: '高塔前', en: 'Tower Front', segmentToNext: 'portal_down', landmarks: ['city_tower'] },
      { code: 'SK04', zh: '雲端', en: 'Cloudside', segmentToNext: 'portal_up' },
      { code: 'SK05', zh: '湖畔', en: 'Lakeside', segmentToNext: 'elevated', landmarks: ['lake'] },
      { code: 'SK06', zh: '機場邊', en: 'Airfield', segmentToNext: 'elevated', landmarks: ['runway', 'lake'] },
      { code: 'SK07', zh: '展覽館', en: 'Expo Hall', segmentToNext: 'elevated', transfer: ['CX'] },
    ],
  },
};

const REVERSED: Record<Segment, Segment> = {
  underground: 'underground',
  elevated: 'elevated',
  portal_up: 'portal_down',
  portal_down: 'portal_up',
};

/** 相鄰兩站之間的區段（反方向行駛時，出入隧道互換） */
export function segmentBetween(line: LineDef, from: number, to: number): Segment {
  return to > from ? line.stations[from].segmentToNext : REVERSED[line.stations[to].segmentToNext];
}

/** 該站本身在地下還是地上：由進站前（或出站後）的區段推得 */
export function stationIsUnderground(line: LineDef, index: number): boolean {
  const s = line.stations;
  const before = index > 0 ? s[index - 1].segmentToNext : s[index].segmentToNext;
  return before === 'underground' || before === 'portal_down';
}

export function landmarksBetween(line: LineDef, from: number, to: number): LandmarkId[] {
  const set = new Set([...(line.stations[from].landmarks ?? []), ...(line.stations[to].landmarks ?? [])]);
  return [...set];
}

/** 轉乘站在另一條線上的索引：同名、且互列為轉乘的那一站；不能轉乘時為 -1（docs/PRD.md §18.1） */
export function transferIndex(from: LineId, station: number, to: LineId): number {
  const here = LINES[from].stations[station];
  if (!here?.transfer?.includes(to)) return -1;
  return LINES[to].stations.findIndex(s => s.zh === here.zh && s.transfer?.includes(from));
}
