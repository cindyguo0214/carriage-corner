// 前後端共用的即時協定型別（規格見 docs/PRD.md §9.1–9.2）

export type LineId = 'CX' | 'RV' | 'SK'; // 北城捷運虛構路線：城心線／河岸線／雲橋線
export type PassCardId = 'tile' | 'boba' | 'ricecooker' | 'mangoice'; // 隨行卡卡面
export type AvatarId = 'office' | 'student' | 'hoodie' | 'headphone';
export type Bench = 'A' | 'B';
export type SeatId = `${1 | 2 | 3 | 4 | 5 | 6}${Bench}`;
export type PaxState = 'idle' | 'coffee' | 'music' | 'read' | 'sleep';
export type GlowKind = 'coffee' | 'cheer';
export type Segment = 'underground' | 'elevated' | 'portal_up' | 'portal_down';
export type Mode = 'morning' | 'night';

export interface Passenger {
  pid: string;
  seat: SeatId;
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
export type AckCode = 'BAD_REQUEST' | 'RATE_LIMITED' | 'FILTERED' | 'NO_TARGET' | 'NOTES_PAUSED' | 'CARE';

export type Ack<T = undefined> =
  | ({ ok: true } & (T extends undefined ? {} : { data: T }))
  | { ok: false; code: AckCode };

export interface BoardedSnapshot {
  serverTime: number;
  resumeToken: string;
  room: { id: string; line: LineId; capacity: number };
  you: { pid: string; seat: SeatId; codename: string };
  train: TrainSnapshot;
  passengers: Passenger[];
  notes: WindowNote[];
}

export interface ClientToServer {
  board: (
    req: { sid: string; resumeToken: string | null; line: LineId; avatar: AvatarId; passCard: PassCardId },
    ack: (res: Ack<BoardedSnapshot>) => void,
  ) => void;
  'state:set': (req: { state: PaxState }, ack: (res: Ack) => void) => void;
  'glow:send': (req: { to: string; kind: GlowKind }, ack: (res: Ack) => void) => void;
  'note:write': (req: { text: string }, ack: (res: Ack<{ nid: string }>) => void) => void;
  'note:report': (req: { nid: string }, ack: (res: Ack) => void) => void;
  'pref:set': (req: { dnd: boolean }, ack: (res: Ack) => void) => void;
  'clock:sync': (t0: number, ack: (serverTime: number) => void) => void;
}

export interface ServerToClient {
  'pax:join': (p: Passenger & { via: 'gangway' | 'door' }) => void;
  'pax:leave': (p: { pid: string; reason: 'station' | 'transfer' }) => void;
  'pax:state': (p: { pid: string; state: PaxState; since: number }) => void;
  glow: (g: { to: string; kind: GlowKind; at: number }) => void;
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
export const PRIORITY_SEATS = new Set<SeatId>(['1A', '6A', '1B', '6B']);
export const NOTE_MAX_GRAPHEMES = 15;
