// DOM 疊層：中文輸入、清晰文字與無障礙都在這裡處理，不畫進 canvas（docs/PRD.md §6.2）
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  LINES, looksLikeContact, NOTE_MAX_GRAPHEMES, splitGraphemes, type PaxState,
} from '@cc/shared';
import { mixer, type Channel } from '../audio/AmbientMixer';
import { bridge } from '../gameBridge';
import { actions, devParams, store, useApp, type PlatformPhase } from '../store';
import { RadialMenu } from './RadialMenu';
import { TicketModal } from './TicketModal';
import { useMoodMusic, Walkman } from './Walkman';

const STATES: { state: PaxState; icon: string; label: string }[] = [
  { state: 'idle', icon: '👀', label: '看窗外' },
  { state: 'music', icon: '🎧', label: '聽音樂' },
  { state: 'read', icon: '📖', label: '專注模式' },
  { state: 'sleep', icon: '😴', label: '補眠' },
];

const CHANNELS: { ch: Channel; icon: string; label: string }[] = [
  { ch: 'rail', icon: '🚃', label: '鐵軌行駛' },
  { ch: 'rain', icon: '🌧', label: '車窗雨聲' },
  { ch: 'lofi', icon: '🎹', label: 'Lo-Fi 鋼琴' },
];

function useTheme() {
  const night = useApp(s => s.mode === 'night');
  return {
    night,
    panel: night ? 'bg-smoke-soft/90 text-oat ring-1 ring-white/10' : 'bg-oat/90 text-ink ring-1 ring-ink/10',
    chip: night ? 'bg-white/10 hover:bg-white/20' : 'bg-ink/5 hover:bg-ink/10',
    chipOn: night ? 'bg-lamp text-smoke' : 'bg-ink text-oat',
  };
}

export function Hud() {
  useMoodMusic();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.setUi({ mixerOpen: false, composerOpen: false, ticketOpen: false, glowMenu: null, noteMenu: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 text-sm sm:p-4">
      <div className="flex flex-col gap-2">
        <TopBar />
        <Toast />
        <Walkman />
      </div>
      <div className="flex flex-col items-center gap-3">
        <Subtitle />
        <BottomBar />
      </div>
      <RadialMenu />
      <NoteMenu />
      <NoteComposer />
      <TicketModal />
    </div>
  );
}

function TopBar() {
  const theme = useTheme();
  const scene = useApp(s => s.scene);
  const mode = useApp(s => s.mode);
  const seat = useApp(s => s.selfSeat);
  const net = useApp(s => s.net);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const hhmm = clock.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <header className="flex flex-wrap items-start justify-between gap-2">
      {scene === 'platform' ? <PlatformInfo /> : <TrainInfo />}
      <div className={`pointer-events-auto ml-auto flex shrink-0 items-center gap-2 rounded px-3 py-2 ${theme.panel}`}>
        <NetBadge net={net} />
        {scene === 'carriage' && seat && <span className="whitespace-nowrap opacity-70">{seat.startsWith('S') ? '站著' : `Seat ${seat}`}</span>}
        <span aria-hidden>{mode === 'night' ? '🌃' : '🌅'}</span>
        <span className="tabular-nums">{hhmm}</span>
        {devParams.dev && (
          <button
            className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${theme.chip}`}
            onClick={() => store.setState({ mode: mode === 'night' ? 'morning' : 'night' })}
          >
            切換晨／夜
          </button>
        )}
      </div>
    </header>
  );
}

function TrainInfo() {
  const theme = useTheme();
  const lineId = useApp(s => s.line);
  const train = useApp(s => s.train);
  const car = useApp(s => s.car);
  const cars = useApp(s => s.cars);
  const line = LINES[lineId];
  const dir = train.to > train.from ? 1 : -1;
  const terminal = line.stations[dir === 1 ? line.stations.length - 1 : 0];
  const next = line.stations[train.to];
  return (
    <div className={`pointer-events-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap rounded px-3 py-2 ${theme.panel}`}>
      <span className="flex items-center gap-1.5 font-medium">
        <span className="inline-block size-2.5 rounded-[2px]" style={{ background: line.color }} />
        {line.id} {line.zh}
      </span>
      <span className="opacity-70">往 {terminal.zh}</span>
      <span aria-live="polite">
        {train.phase === 'dwell' ? <>到站 ▸ <b>{next.zh}</b></> : <>下一站 ▸ <b>{next.zh}</b></>}
      </span>
      <span className="flex items-center gap-1" aria-label={`第 ${car} 節車廂，共 ${cars} 節`}>
        <button
          aria-label="走到前一節車廂"
          disabled={car <= 1}
          className={`rounded px-1.5 disabled:opacity-30 ${theme.chip}`}
          onClick={() => bridge.game?.moveCar(-1)}
        >
          ◀
        </button>
        <span className="tabular-nums">第 {car}/{cars} 節</span>
        <button
          aria-label="走到後一節車廂"
          disabled={car >= cars}
          className={`rounded px-1.5 disabled:opacity-30 ${theme.chip}`}
          onClick={() => bridge.game?.moveCar(1)}
        >
          ▶
        </button>
      </span>
    </div>
  );
}

const PLATFORM_STATUS: Record<PlatformPhase, string> = {
  away: '下一班車',
  arriving: '列車進站中',
  open: '車門開啟・請上車',
  closing: '車門關閉中',
  leaving: '列車出站',
};

function PlatformInfo() {
  const theme = useTheme();
  const lineId = useApp(s => s.line);
  const platform = useApp(s => s.platform);
  const line = LINES[lineId];
  const station = line.stations[platform.station];
  const toward = line.stations[platform.toward];
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((platform.at - now) / 1000));
  return (
    <div className={`pointer-events-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap rounded px-3 py-2 ${theme.panel}`}>
      <span className="flex items-center gap-1.5 font-medium">
        <span className="inline-block size-2.5 rounded-[2px]" style={{ background: line.color }} />
        {station.zh} 月台
      </span>
      <span className="opacity-70">往 {toward.zh}</span>
      <span aria-live="polite">
        {PLATFORM_STATUS[platform.phase]}
        {platform.phase === 'away' && <> ▸ <b className="tabular-nums">{left} 秒</b></>}
      </span>
    </div>
  );
}

function NetBadge({ net }: { net: 'online' | 'reconnecting' | 'offline' }) {
  const label = { online: '同車連線中', reconnecting: '訊號較弱，重新連線中', offline: '離線模式：車廂裡的人是本機模擬' }[net];
  const color = { online: 'bg-sage', reconnecting: 'bg-lamp animate-pulse', offline: 'bg-rose' }[net];
  return (
    <span title={label} aria-label={label} className="flex items-center">
      <span className={`inline-block size-2 rounded-full ${color}`} />
    </span>
  );
}

/** 只有自己看得到的輕提示：例如有人對你點頭 */
function Toast() {
  const theme = useTheme();
  const toast = useApp(s => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return (
    <p
      role="status"
      className={`self-center rounded px-3 py-1.5 transition-opacity duration-700 ${theme.panel} ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {toast.text}
    </p>
  );
}

function Subtitle() {
  const subtitle = useApp(s => s.subtitle);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!subtitle) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 7000);
    return () => clearTimeout(id);
  }, [subtitle]);
  if (!subtitle) return null;
  const [zh, en] = subtitle.text.split('｜');
  return (
    <p
      aria-live="polite"
      className={`max-w-xl rounded bg-black/45 px-4 py-2 text-center leading-relaxed text-oat transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {zh}
      {en && <span className="block text-xs opacity-75">{en}</span>}
    </p>
  );
}

function BottomBar() {
  const scene = useApp(s => s.scene);
  const mixerOpen = useApp(s => s.ui.mixerOpen);
  return (
    <div className="relative flex flex-col items-center">
      {mixerOpen && (
        <>
          {/* 點畫面其他地方就收起；這一下不會穿透到遊戲畫面（不會順便走路或點到人） */}
          <div className="pointer-events-auto fixed inset-0" aria-hidden onClick={() => actions.setUi({ mixerOpen: false })} />
          <MixerPanel />
        </>
      )}
      {/* 疊在透明遮罩上面：開著面板時底部按鈕照樣能按 */}
      <div className="relative">{scene === 'platform' ? <PlatformBar /> : <CarriageBar />}</div>
    </div>
  );
}

/** 底部按鈕：圖示＋看得到的中文標籤，不只靠圖示猜意思 */
function BarButton({
  icon, label, onClick, on = false, primary = false, title, expanded,
}: {
  icon: string; label: string; onClick: () => void; on?: boolean; primary?: boolean; title?: string; expanded?: boolean;
}) {
  const theme = useTheme();
  return (
    <button
      aria-pressed={expanded === undefined && !primary ? on : undefined}
      aria-expanded={expanded}
      title={title ?? label}
      className={`flex min-w-12 flex-col items-center gap-0.5 rounded px-2 py-1 transition-colors ${on || primary ? theme.chipOn : theme.chip}`}
      onClick={onClick}
    >
      <span className="text-base leading-none" aria-hidden>{icon}</span>
      <span className="whitespace-nowrap text-[11px] leading-none">{label}</span>
    </button>
  );
}

function PlatformBar() {
  const theme = useTheme();
  const hasRide = useApp(s => !!s.ride);
  const canTransfer = useApp(s => !!LINES[s.line].stations[s.platform.station]?.transfer?.length);
  return (
    <nav aria-label="月台" className={`pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded p-1.5 ${theme.panel}`}>
      <span className="px-2 text-xs opacity-80">點長椅坐下・車門開了點車門上車{canTransfer && '・點轉乘指標換線'}</span>
      <span className="mx-1 h-8 w-px bg-current opacity-20" aria-hidden />
      <ExtraButtons ticket={hasRide} />
    </nav>
  );
}

function CarriageBar() {
  const theme = useTheme();
  const selfState = useApp(s => s.selfState);
  const standing = useApp(s => !!s.selfSeat?.startsWith('S'));
  const dwell = useApp(s => s.train.phase === 'dwell');
  return (
    <nav aria-label="乘客動作" className={`pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded p-1.5 ${theme.panel}`}>
      <BarButton icon="✍" label="車窗寫字" title="在身旁的車窗霧氣上寫一句話" onClick={() => actions.setUi({ composerOpen: true, glowMenu: null })} />
      <span className="mx-0.5 h-8 w-px bg-current opacity-20" aria-hidden />
      <div role="group" aria-label="角色狀態" className="flex items-center gap-1">
        <span className="text-[10px] leading-tight opacity-60 [writing-mode:vertical-rl]" aria-hidden>角色狀態</span>
        {standing ? (
          <span className="px-2 text-xs opacity-80">拉著吊環・點空位坐下</span>
        ) : (
          STATES.map(s => (
            <BarButton
              key={s.state}
              icon={s.icon}
              label={s.label}
              on={selfState === s.state}
              onClick={() => actions.setSelfState(s.state)}
            />
          ))
        )}
        <Pomodoro />
      </div>
      <span className="mx-0.5 h-8 w-px bg-current opacity-20" aria-hidden />
      {dwell && <BarButton icon="🚪" label="下車" primary title="車門開著，現在可以下車" onClick={() => bridge.game?.alight()} />}
      <ExtraButtons ticket />
    </nav>
  );
}

function ExtraButtons({ ticket }: { ticket: boolean }) {
  const mixerOpen = useApp(s => s.ui.mixerOpen);
  return (
    <>
      <BarButton icon="🎚" label="音效" expanded={mixerOpen} on={mixerOpen} onClick={() => actions.setUi({ mixerOpen: !mixerOpen })} />
      {ticket && (
        <BarButton icon="🎫" label="車票" onClick={() => actions.setUi({ ticketOpen: true, mixerOpen: false, glowMenu: null, noteMenu: null })} />
      )}
    </>
  );
}

function Pomodoro() {
  const pomodoro = useApp(s => s.pomodoro);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pomodoro) {
      document.title = '車廂角落 Carriage Corner';
      return;
    }
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const left = pomodoro.startedAt + pomodoro.durationMs - t;
      if (left <= 0) {
        mixer.playPomodoroBell();
        if (pomodoro.kind === 'focus') {
          store.setState(s => ({ pomodorosDone: s.pomodorosDone + 1 }));
          actions.say('這一段專注到站了。休息五分鐘，看看窗外吧。');
          store.setState({ pomodoro: { kind: 'break', startedAt: t, durationMs: 5 * 60_000 } });
        } else {
          store.setState({ pomodoro: { kind: 'focus', startedAt: t, durationMs: devParams.focusMin * 60_000 } });
        }
        return;
      }
      document.title = `${pomodoro.kind === 'focus' ? '📖' : '☕'} ${fmt(left)} · 車廂角落`;
    };
    tick();
    // 以時間戳計算剩餘時間，背景分頁被節流也不會走歪
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pomodoro]);
  if (!pomodoro) return null;
  const left = Math.max(0, pomodoro.startedAt + pomodoro.durationMs - now);
  return (
    <span className="px-1.5 tabular-nums" aria-label={pomodoro.kind === 'focus' ? '專注剩餘時間' : '休息剩餘時間'}>
      {pomodoro.kind === 'focus' ? '' : '休息 '}
      {fmt(left)}
    </span>
  );
}

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function MixerPanel() {
  const theme = useTheme();
  const settings = useSyncExternalStore(fn => mixer.subscribe(fn), () => mixer.state);
  return (
    <section aria-label="環境音效" className={`pointer-events-auto absolute bottom-full mb-2 w-72 rounded p-3 ${theme.panel}`}>
      <ul className="space-y-2">
        {CHANNELS.map(c => (
          <li key={c.ch} className="flex items-center gap-2">
            <button
              aria-pressed={settings.on[c.ch]}
              className={`w-28 shrink-0 rounded px-2 py-1 text-left ${settings.on[c.ch] ? theme.chipOn : theme.chip}`}
              onClick={() => void mixer.setChannel(c.ch, !settings.on[c.ch])}
            >
              {c.icon} {c.label}
            </button>
            <input
              type="range" min={0} max={1} step={0.01} aria-label={`${c.label}音量`}
              value={settings.level[c.ch]}
              onChange={e => void mixer.setLevel(c.ch, Number(e.target.value))}
              className="w-full accent-rose"
            />
          </li>
        ))}
        <li className="flex items-center gap-2 pt-1">
          <span className="w-28 shrink-0 px-2 opacity-80">🔈 主音量</span>
          <input
            type="range" min={0} max={1} step={0.01} aria-label="主音量"
            value={settings.master}
            onChange={e => mixer.setMaster(Number(e.target.value))}
            className="w-full accent-rose"
          />
        </li>
      </ul>
      <DndToggle />
    </section>
  );
}

function DndToggle() {
  const theme = useTheme();
  const dnd = useApp(s => s.dnd);
  return (
    <button
      role="switch"
      aria-checked={dnd}
      onClick={() => store.setState({ dnd: !dnd })}
      className={`mt-3 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${dnd ? theme.chipOn : theme.chip}`}
    >
      <span className="text-base leading-none" aria-hidden>{dnd ? '🔕' : '🔔'}</span>
      <span className="flex flex-1 flex-col">
        <span className="font-medium">勿擾模式：{dnd ? '開啟' : '關閉'}</span>
        <span className="text-[11px] leading-snug opacity-75">
          {dnd ? '別人的嗶卡、同頻、小毯、幸運籤都不會打擾你' : '會收到別人的嗶卡、同頻、小毯、幸運籤'}
        </span>
      </span>
    </button>
  );
}

/** 點別人寫在車窗上的字：不能回覆、不能按讚，只能擦掉（只有自己看不到）或檢舉 */
function NoteMenu() {
  const theme = useTheme();
  const menu = useApp(s => s.ui.noteMenu);
  if (!menu) return null;
  const close = () => actions.setUi({ noteMenu: null });
  const x = Math.min(menu.x, window.innerWidth - 240);
  const y = Math.max(menu.y - 64, 8);
  return (
    <div role="menu" aria-label="車窗上的留言" className={`pointer-events-auto fixed flex gap-1 rounded p-1.5 ${theme.panel}`} style={{ left: x, top: y }}>
      <button role="menuitem" autoFocus className={`rounded px-2.5 py-1.5 ${theme.chip}`} onClick={() => { bridge.game?.wipeNote(menu.window); close(); }}>
        🧽 擦掉
      </button>
      <button role="menuitem" className={`rounded px-2.5 py-1.5 ${theme.chip}`} onClick={() => { void bridge.game?.reportNote(menu.window); close(); actions.toast('謝謝你，我們會處理。'); }}>
        🚩 檢舉
      </button>
      <button role="menuitem" className={`rounded px-2.5 py-1.5 ${theme.chip}`} onClick={() => actions.setUi({ noteMenu: null, composerOpen: true })}>
        ✍ 寫自己的
      </button>
    </div>
  );
}

// UX 文案（docs/PRD.md 附錄 C）
const NOTE_ERRORS = {
  FILTERED: '這句話被霧氣吃掉了，換個說法試試？',
  RATE_LIMITED: '車窗還很濕，等下一站再寫吧。',
  NOTES_PAUSED: '車窗正在清潔中，晚點再來寫。',
  NETWORK: '訊號不太好，再試一次？',
} as const;

function NoteComposer() {
  const theme = useTheme();
  const open = useApp(s => s.ui.composerOpen);
  const mode = useApp(s => s.mode);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [care, setCare] = useState(false);
  const [sending, setSending] = useState(false);
  const composing = useRef(false);
  if (!open) return null;

  const count = splitGraphemes(text).length;
  const close = () => {
    setText('');
    setError('');
    setCare(false);
    actions.setUi({ composerOpen: false });
  };
  const clamp = (v: string) => splitGraphemes(v).slice(0, NOTE_MAX_GRAPHEMES).join('');
  const submit = async () => {
    const t = text.trim();
    if (!t || sending || !bridge.game) return;
    if (looksLikeContact(t)) {
      setError(NOTE_ERRORS.FILTERED);
      return;
    }
    setSending(true);
    const res = await bridge.game.writeNote(t);
    setSending(false);
    if (res.ok) {
      store.setState({ myNote: t });
      return close();
    }
    if (res.code === 'CARE') return setCare(true);
    setError(NOTE_ERRORS[res.code as keyof typeof NOTE_ERRORS] ?? NOTE_ERRORS.NETWORK);
  };

  return (
    <div className="pointer-events-auto fixed inset-0 grid place-items-center bg-black/30 p-4" onClick={close}>
      <form
        role="dialog"
        aria-label="在車窗霧氣上寫一句話"
        className={`w-full max-w-sm rounded p-4 ${theme.panel}`}
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault();
          void submit();
        }}
      >
        {care && (
          <div role="alert" className={`mb-3 rounded p-3 leading-relaxed ${theme.night ? 'bg-white/10' : 'bg-white/70'}`}>
            看起來你現在很辛苦。這句話不會出現在車窗上，只有你看得到。
            <br />
            想找人說說話的話，可以撥打 <b>1925 安心專線</b>（24 小時、免付費），會有人好好聽你說。
          </div>
        )}
        <p className="mb-2 opacity-80">{mode === 'morning' ? '本日宣言' : '此刻心情'}・寫在身旁的車窗上，會慢慢被霧氣蓋住</p>
        <input
          autoFocus
          value={text}
          placeholder={mode === 'morning' ? '今天我要……' : '現在的心情是……'}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={e => {
            composing.current = false;
            setText(clamp(e.currentTarget.value));
          }}
          onChange={e => {
            setError('');
            // 輸入法組字中不截斷，避免吃掉注音
            setText(composing.current ? e.target.value : clamp(e.target.value));
          }}
          className={`w-full rounded px-3 py-2 text-base outline-none ring-1 ${theme.night ? 'bg-black/20 ring-white/20' : 'bg-white/70 ring-ink/20'}`}
        />
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className={error ? 'text-rose' : 'opacity-60'}>{error || '不能按讚、不能回覆，只是寫下來。'}</span>
          <span className="tabular-nums opacity-60">{count}/{NOTE_MAX_GRAPHEMES}</span>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={`rounded px-3 py-1.5 ${theme.chip}`} onClick={close}>算了</button>
          <button type="submit" disabled={!text.trim() || sending} className={`rounded px-3 py-1.5 disabled:opacity-40 ${theme.chipOn}`}>寫上去</button>
        </div>
      </form>
    </div>
  );
}
