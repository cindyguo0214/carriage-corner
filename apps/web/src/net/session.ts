// 連線層：進站、時鐘校正、斷線重連（docs/PRD.md §7.6）
import { io, type Socket } from 'socket.io-client';
import type { AvatarId, BoardedSnapshot, ClientToServer, LineId, PassCardId, ServerToClient } from '@cc/shared';

export type GameSocket = Socket<ServerToClient, ClientToServer>;

export interface BoardRequest {
  line: LineId;
  avatar: AvatarId;
  passCard: PassCardId;
}

export interface NetSession {
  socket: GameSocket;
  snapshot: BoardedSnapshot;
  /** 伺服器時間 − 本機時間（ms）；本機時間 = 伺服器時間 − offset */
  offset: number;
  /** 重連後重新進站成功時呼叫，帶著新的快照 */
  onResync(fn: (snapshot: BoardedSnapshot) => void): void;
  onStatus(fn: (status: 'online' | 'reconnecting') => void): void;
}

const SID_KEY = 'cc.sid';
const RESUME_KEY = 'cc.resume';
const CONNECT_TIMEOUT_MS = 4000;

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
  set: (t: string) => { try { sessionStorage.setItem(RESUME_KEY, t); } catch { /* 忽略 */ } },
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
export async function connectAndBoard(req: BoardRequest): Promise<NetSession | null> {
  const socket: GameSocket = io({ transports: ['websocket'], reconnectionDelayMax: 8000 });
  const sid = anonymousSid();

  const board = async () => {
    const res = await socket.timeout(CONNECT_TIMEOUT_MS).emitWithAck('board', { sid, resumeToken: resumeStore.get(), ...req });
    if (!res.ok) throw new Error(`board rejected: ${res.code}`);
    resumeStore.set(res.data.resumeToken);
    return res.data;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', err => { clearTimeout(timer); reject(err); });
    });
    const snapshot = await board();
    const offset = await syncClock(socket);

    const resyncListeners: ((s: BoardedSnapshot) => void)[] = [];
    const statusListeners: ((s: 'online' | 'reconnecting') => void)[] = [];
    const session: NetSession = {
      socket,
      snapshot,
      offset,
      onResync: fn => resyncListeners.push(fn),
      onStatus: fn => statusListeners.push(fn),
    };

    socket.on('disconnect', () => statusListeners.forEach(fn => fn('reconnecting')));
    socket.io.on('reconnect', async () => {
      try {
        const snap = await board();
        session.offset = await syncClock(socket);
        session.snapshot = snap;
        resyncListeners.forEach(fn => fn(snap));
        statusListeners.forEach(fn => fn('online'));
      } catch (err) {
        console.warn('[net] resync failed', err);
      }
    });
    return session;
  } catch (err) {
    console.warn('[net] 無法連上伺服器，改用離線模式', err);
    socket.disconnect();
    return null;
  }
}
