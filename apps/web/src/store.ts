// 全域狀態：Pixi 場景、音訊與 React HUD 各自訂閱需要的切片（docs/PRD.md §6.3）
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { AvatarId, Gender, LineId, Mode, PassCardId, PaxState, SpotId } from '@cc/shared';

export interface Pomodoro {
  kind: 'focus' | 'break';
  startedAt: number;
  durationMs: number;
}

export interface GlowMenu {
  seat: SpotId;
  name: string;
  /** 以 CSS px 表示的選單位置 */
  x: number;
  y: number;
}

export interface NoteMenu {
  window: number;
  x: number;
  y: number;
}

/** 月台上的列車：away 還沒來、arriving 進站中、open 開門、closing 關門、leaving 出站 */
export type PlatformPhase = 'away' | 'arriving' | 'open' | 'closing' | 'leaving';

export interface AppState {
  line: LineId;
  /** 頭上的名字（連線時以伺服器過濾後的為準） */
  name: string;
  gender: Gender;
  avatar: AvatarId;
  passCard: PassCardId;
  boarded: boolean;
  /** 目前在月台還是車廂 */
  scene: 'platform' | 'carriage';
  /** 第幾節車廂／總節數 */
  car: number;
  cars: number;
  /** 月台：所在站、列車狀態與預計時間（本機毫秒） */
  platform: { station: number; phase: PlatformPhase; at: number; toward: number };
  /** offline：連不上伺服器時的本機模擬 */
  net: 'online' | 'reconnecting' | 'offline';
  mode: Mode;
  selfPid: string | null;
  selfSeat: SpotId | null;
  selfState: PaxState;
  /** 勿擾：不接收別人送的微光 */
  dnd: boolean;
  /** 只有自己看得到的輕提示（例如有人點頭） */
  toast: { text: string; at: number } | null;
  rain: boolean;
  /** 列車狀態只在事件時更新，不逐幀寫入 */
  train: { from: number; to: number; phase: 'run' | 'dwell' };
  subtitle: { text: string; at: number } | null;
  pomodoro: Pomodoro | null;
  pomodorosDone: number;
  cheersReceived: number;
  /** 這趟旅程：車票明信片的素材，只存在本機。下車後 toIdx 記下下車站 */
  ride: { boardedAt: number; fromIdx: number; toIdx?: number; endedAt?: number; seat?: SpotId; roomId: string; coRiders: number } | null;
  /** 自己最近一次寫在車窗上的話（可選擇印在車票上，不進公開連結） */
  myNote: string | null;
  ui: { mixerOpen: boolean; composerOpen: boolean; ticketOpen: boolean; glowMenu: GlowMenu | null; noteMenu: NoteMenu | null };
}

const params = new URLSearchParams(location.search);

export function modeForHour(hour: number): Mode {
  return hour >= 6 && hour < 17 ? 'morning' : 'night';
}

const initialMode = (params.get('mode') as Mode | null) ?? modeForHour(new Date().getHours());

export const store = createStore<AppState>(() => ({
  line: 'CX',
  name: '',
  gender: 'm',
  avatar: 'office',
  passCard: 'tile',
  boarded: false,
  scene: 'platform',
  car: 1,
  cars: 4,
  platform: { station: 0, phase: 'away', at: 0, toward: 1 },
  net: 'offline',
  mode: initialMode === 'morning' || initialMode === 'night' ? initialMode : 'night',
  selfPid: null,
  selfSeat: null,
  selfState: 'idle',
  dnd: false,
  toast: null,
  rain: false,
  train: { from: 0, to: 1, phase: 'run' },
  subtitle: null,
  pomodoro: null,
  pomodorosDone: 0,
  cheersReceived: 0,
  ride: null,
  myNote: null,
  ui: { mixerOpen: false, composerOpen: false, ticketOpen: false, glowMenu: null, noteMenu: null },
}));

export const useApp = <T,>(selector: (s: AppState) => T) => useStore(store, selector);

/** 開發用參數：?run=秒&dwell=秒&pomo=分鐘&noteTtl=秒&dev=1 */
export const devParams = {
  runSec: Number(params.get('run')) || 75,
  dwellSec: Number(params.get('dwell')) || 16,
  focusMin: Number(params.get('pomo')) || 25,
  noteTtlSec: Number(params.get('noteTtl')) || 8 * 60,
  dev: params.has('dev'),
};

export const actions = {
  setUi(patch: Partial<AppState['ui']>) {
    store.setState(s => ({ ui: { ...s.ui, ...patch } }));
  },
  say(text: string) {
    store.setState({ subtitle: { text, at: Date.now() } });
  },
  toast(text: string) {
    store.setState({ toast: { text, at: Date.now() } });
  },
  setSelfState(state: PaxState) {
    const prev = store.getState().selfState;
    store.setState({ selfState: state });
    if (state === 'read' && prev !== 'read') {
      store.setState({ pomodoro: { kind: 'focus', startedAt: Date.now(), durationMs: devParams.focusMin * 60_000 } });
    } else if (state !== 'read') {
      store.setState({ pomodoro: null });
    }
  },
};
