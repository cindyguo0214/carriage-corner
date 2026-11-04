// 前後端共用的即時協定型別（規格見 docs/PRD.md §9.1–9.2）

export type LineId = 'CX' | 'RV' | 'SK'; // 北城捷運虛構路線：城心線／河岸線／雲橋線
export type PassCardId = 'tile' | 'boba' | 'ricecooker' | 'mangoice'; // 隨行卡卡面
export type AvatarId = 'office' | 'student' | 'hoodie' | 'headphone';
export type Gender = 'm' | 'f';
export type Bench = 'A' | 'B';
export type SeatId = `${1 | 2 | 3 | 4 | 5 | 6}${Bench}`;
/** 走道上拉吊環的站位（S1..S6，與座位同一欄） */
export type StandId = `S${1 | 2 | 3 | 4 | 5 | 6}`;
/** 車廂裡的位置：座位或站位 */
export type SpotId = SeatId | StandId;
// 車廂內禁止飲食：沒有「喝咖啡」狀態，也沒有「遞咖啡」
export type PaxState = 'idle' | 'music' | 'read' | 'sleep';
// 對其他乘客的互動（docs/PRD.md 第 17 章）：嗶卡默契、同頻波紋、蓋上小毯（對方補眠時）、遞幸運籤
export type GlowKind = 'beep' | 'wave' | 'blanket' | 'fortune';
export type Segment = 'underground' | 'elevated' | 'portal_up' | 'portal_down';
export type Mode = 'morning' | 'night';

export interface Passenger {
  pid: string;
  seat: SpotId;
  /** 顯示在頭上的名字（伺服器過濾過） */
  name: string;
  gender: Gender;
  avatar: AvatarId;
  state: PaxState;
  since: number;
  npc?: true;
}

export interface TrainSnapshot {
  dir: string;
  from: string;
  to: string;
  departAt: number;
  arriveAt: number;
  /** 到站後開門停靠的毫秒數 */
  dwellMs: number;
  segment: Segment;
}

export interface WindowNote {
  nid: string;
  window: number;
  text: string;
  mode: Mode;
  createdAt: number;
  expiresAt: number;
}

/** CARE：留言含自傷字詞，不廣播，改在本人畫面溫柔顯示求助資源（docs/PRD.md §7.7） */
/** MISSED：要搭的那班車已經關門開走（或還沒進站） */
export type AckCode = 'BAD_REQUEST' | 'RATE_LIMITED' | 'FILTERED' | 'NO_TARGET' | 'NOTES_PAUSED' | 'CARE' | 'MISSED';

export type Ack<T = undefined> =
  | ({ ok: true } & (T extends undefined ? {} : { data: T }))
  | { ok: false; code: AckCode };

export interface BoardedSnapshot {
  serverTime: number;
  resumeToken: string;
  /** id 是這節車廂；train 是整列車（車票編號用），car 為第幾節（1..cars） */
  room: { id: string; train: string; line: LineId; capacity: number; car: number; cars: number };
  you: { pid: string; seat: SpotId; name: string };
  train: TrainSnapshot;
  passengers: Passenger[];
  notes: WindowNote[];
}

/** 月台上下一班停靠這站的列車（docs/PRD.md 第 19 章）；時間為伺服器時鐘 */
export interface PlatformArrival {
  /** 列車編號；預定加開、還沒開出的列車也先給編號 */
  train: string;
  arriveAt: number;
  /** 關門離站的時間 */
  departAt: number;
  /** 離站後的方向：1 往最後一站、-1 往第一站 */
  dir: 1 | -1;
}

export interface ClientToServer {
  /**
   * 上車。帶 station 與 train（來自 platform:next）時，只會坐進那班正停在這站的列車；
   * 不帶時（斷線重連）照舊分流到這條線最熱絡的車廂。
   */
  board: (
    req: {
      sid: string; resumeToken: string | null; line: LineId;
      name: string; gender: Gender; avatar: AvatarId; passCard: PassCardId;
      station?: number; train?: string;
    },
    ack: (res: Ack<BoardedSnapshot>) => void,
  ) => void;
  /** 月台上：下一班停靠這站的列車 */
  'platform:next': (req: { line: LineId; station: number }, ack: (res: Ack<PlatformArrival>) => void) => void;
  /** 停站開門時下車回到月台 */
  alight: (req: {}, ack: (res: Ack) => void) => void;
  /** 換到同一節車廂的空位，或站到走道上拉吊環 */
  'seat:move': (req: { seat: SpotId }, ack: (res: Ack) => void) => void;
  /** 經貫通道走到相鄰車廂：-1 往第 1 節、+1 往最後一節 */
  'car:move': (req: { dir: -1 | 1 }, ack: (res: Ack<BoardedSnapshot>) => void) => void;
  'state:set': (req: { state: PaxState }, ack: (res: Ack) => void) => void;
  /** fortune：遞幸運籤時伺服器抽的籤（FORTUNES 索引），其他種類為 null */
  'glow:send': (req: { to: string; kind: GlowKind }, ack: (res: Ack<{ fortune: number | null }>) => void) => void;
  'note:write': (req: { text: string }, ack: (res: Ack<{ nid: string }>) => void) => void;
  'note:report': (req: { nid: string }, ack: (res: Ack) => void) => void;
  'pref:set': (req: { dnd: boolean }, ack: (res: Ack) => void) => void;
  'clock:sync': (t0: number, ack: (serverTime: number) => void) => void;
}

export interface ServerToClient {
  'pax:join': (p: Passenger & { via: 'gangway' | 'door' }) => void;
  'pax:leave': (p: { pid: string; reason: 'station' | 'transfer' }) => void;
  'pax:move': (p: { pid: string; seat: SpotId }) => void;
  'pax:state': (p: { pid: string; state: PaxState; since: number }) => void;
  glow: (g: { to: string; kind: GlowKind; at: number; fortune: number | null }) => void;
  'note:new': (n: WindowNote) => void;
  'note:gone': (n: { nid: string }) => void;
  'train:arrive': (e: {
    station: string;
    doorsOpenMs: number;
    leaving: string[];
    npc: { leave: string[]; board: Passenger[] };
  }) => void;
  'train:depart': (e: { train: TrainSnapshot }) => void;
  notice: (n: { kind: 'maintenance' | 'notes_paused'; message: string }) => void;
}

export const SEATS: SeatId[] = [1, 2, 3, 4, 5, 6].flatMap(n => [`${n}A`, `${n}B`] as SeatId[]);
export const STANDS: StandId[] = [1, 2, 3, 4, 5, 6].map(n => `S${n}` as StandId);
export const SPOTS: SpotId[] = [...SEATS, ...STANDS];
export const isStand = (spot: SpotId): spot is StandId => spot[0] === 'S';
/** 位置所在的欄（1..6）：決定寫字時用哪一扇車窗 */
export const spotColumn = (spot: SpotId) => Number(isStand(spot) ? spot[1] : spot[0]);
export const PRIORITY_SEATS = new Set<SpotId>(['1A', '6A', '1B', '6B']);
export const NOTE_MAX_GRAPHEMES = 15;
export const NAME_MAX_GRAPHEMES = 8;
/** 名字被過濾或留白時的替代名 */
export const FALLBACK_NAME = '旅人';
/** 一列車的車廂數 */
export const CARS = 4;
export const GLOW_KINDS: GlowKind[] = ['beep', 'wave', 'blanket', 'fortune'];
export const PAX_STATES: PaxState[] = ['idle', 'music', 'read', 'sleep'];
export const AVATARS: AvatarId[] = ['office', 'student', 'hoodie', 'headphone'];
