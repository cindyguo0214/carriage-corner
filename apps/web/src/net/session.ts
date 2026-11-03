// 連線層：連線、時鐘校正、上下車、換座位與換車廂、斷線重連（docs/PRD.md §7.6）
import { io, type Socket } from 'socket.io-client';
import type {
  AvatarId, BoardedSnapshot, ClientToServer, Gender, LineId, PassCardId, ServerToClient, SpotId,
} from '@cc/shared';

export type GameSocket = Socket<ServerToClient, ClientToServer>;

export interface BoardRequest {
  line: LineId;
  name: string;
  gender: Gender;
  avatar: AvatarId;
  passCard: PassCardId;
}

export interface NetLink {
  socket: GameSocket;
  /** 伺服器時間 − 本機時間（ms）；本機時間 = 伺服器時間 − offset */
  offset: number;
  /** 目前是否坐在某節車廂裡（在月台上為 false） */
  readonly boarded: boolean;
  /** 從月台上車；失敗時回傳 null */
  board(req: BoardRequest): Promise<BoardedSnapshot | null>;
  /** 到站開門時下車 */
  alight(): Promise<boolean>;
  moveSeat(seat: SpotId): Promise<boolean>;
  moveCar(dir: -1 | 1): Promise<BoardedSnapshot | null>;
  /** 在車廂裡斷線重連、重新進站成功時呼叫，帶著新的快照 */
  onResync(fn: (snapshot: BoardedSnapshot) => void): () => void;
  onStatus(fn: (status: 'online' | 'reconnecting') => void): () => void;
}

const SID_KEY = 'cc.sid';
const RESUME_KEY = 'cc.resume';
const CONNECT_TIMEOUT_MS = 4000;
const ACK_TIMEOUT_MS = 4000;

/** 匿名識別：存在 localStorage；無痕或被封鎖時每次產生新的 */
function anonymousSid(): string {
  try {
    let sid = localStorage.getItem(SID_KEY);
    if (!sid) {
      sid = `anon_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      localStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return `anon_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  }
}

/** resumeToken 只存在這個分頁：重新整理可回到原座位，另開分頁則是另一位乘客 */
const resumeStore = {
  get: () => { try { return sessionStorage.getItem(RESUME_KEY); } catch { return null; } },
  set: (t: string | null) => {
    try {
      if (t) sessionStorage.setItem(RESUME_KEY, t);
      else sessionStorage.removeItem(RESUME_KEY);
    } catch { /* 忽略 */ }
  },
};

async function syncClock(socket: GameSocket): Promise<number> {
  let best = { rtt: Infinity, offset: 0 };
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const serverTime = await socket.timeout(2000).emitWithAck('clock:sync', t0);
    const t1 = Date.now();
    if (t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: serverTime - (t0 + t1) / 2 };
  }
  return best.offset;
}

/** 連不上伺服器時回傳 null，由呼叫端改走離線模式 */
export async function connect(): Promise<NetLink | null> {
  const socket: GameSocket = io({ transports: ['websocket'], reconnectionDelayMax: 8000 });
  const sid = anonymousSid();
  let lastReq: BoardRequest | null = null;
  let boarded = false;
  const resyncListeners = new Set<(s: BoardedSnapshot) => void>();
  const statusListeners = new Set<(s: 'online' | 'reconnecting') => void>();

  const sendBoard = async (req: BoardRequest) => {
    const res = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('board', { sid, resumeToken: resumeStore.get(), ...req });
    if (!res.ok) throw new Error(`board rejected: ${res.code}`);
    resumeStore.set(res.data.resumeToken);
    boarded = true;
    return res.data;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', err => { clearTimeout(timer); reject(err); });
    });
    const link: NetLink = {
      socket,
      offset: await syncClock(socket),
      get boarded() {
        return boarded;
      },
      async board(req) {
        lastReq = req;
        try {
          return await sendBoard(req);
        } catch (err) {
          console.warn('[net] board failed', err);
          return null;
        }
      },
      async alight() {
        const res = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('alight', {}).catch(() => null);
        if (!res?.ok) return false;
        boarded = false;
        resumeStore.set(null);
        return true;
      },
      async moveSeat(seat) {
        const res = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('seat:move', { seat }).catch(() => null);
        return !!res?.ok;
      },
      async moveCar(dir) {
        const res = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('car:move', { dir }).catch(() => null);
        if (!res?.ok) return null;
        resumeStore.set(res.data.resumeToken);
        return res.data;
      },
      onResync: fn => {
        resyncListeners.add(fn);
        return () => resyncListeners.delete(fn);
      },
      onStatus: fn => {
        statusListeners.add(fn);
        return () => statusListeners.delete(fn);
      },
    };

    socket.on('disconnect', () => statusListeners.forEach(fn => fn('reconnecting')));
    socket.io.on('reconnect', async () => {
      try {
        link.offset = await syncClock(socket);
        // 在月台上就不用重新進站
        if (boarded && lastReq) {
          const snap = await sendBoard(lastReq);
          resyncListeners.forEach(fn => fn(snap));
        }
        statusListeners.forEach(fn => fn('online'));
      } catch (err) {
        console.warn('[net] resync failed', err);
      }
    });
    return link;
  } catch (err) {
    console.warn('[net] 無法連上伺服器，改用離線模式', err);
    socket.disconnect();
    return null;
  }
}
