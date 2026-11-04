// 🎫 車票明信片：預覽、換一句語錄、選擇是否印上自己的車窗留言、分享（docs/PRD.md §8）
import { useEffect, useMemo, useState } from 'react';
import { LINES, QUOTES, shareText, ticketSerial, type TicketStats } from '@cc/shared';
import { bridge } from '../gameBridge';
import { actions, store, useApp } from '../store';
import { renderTicket } from '../ticket/render';
import { copyText, isInAppBrowser, saveImage, shareImage, threadsIntentUrl } from '../ticket/share';

/** claude.ai Artifact 版：系統分享被擋，改用 downloads 能力存檔（iOS 會開分享表單） */
const ARTIFACT = import.meta.env.VITE_TARGET === 'artifact';

/** 沒有簽章連結時（離線、Artifact 版）車票指向的網址 */
function fallbackUrl(line: string) {
  const configured = import.meta.env.VITE_SHARE_URL as string | undefined;
  return configured || `${location.origin}${location.pathname}?line=${line}`;
}

function buildStats(): TicketStats | null {
  const s = store.getState();
  const seat = s.ride?.seat ?? s.selfSeat;
  if (!s.ride || !seat || !bridge.game) return null;
  const line = LINES[s.ride.line];
  // 已下車：用下車站；還在車上：此刻的站，剛上車還沒經過任何一站時寫「下一站」
  const now = s.ride.toIdx ?? bridge.game.currentStation();
  const toIdx = s.ride.toIdx === undefined && now === s.ride.fromIdx ? s.train.to : now;
  const endedAt = s.ride.endedAt ?? Date.now();
  return {
    line: s.ride.line,
    from: line.stations[s.ride.fromIdx].code,
    to: line.stations[toIdx].code,
    seat,
    boardedAt: s.ride.boardedAt,
    minutes: Math.max(1, Math.round((endedAt - s.ride.boardedAt) / 60_000)),
    pomodoros: s.pomodorosDone,
    received: s.received,
    fortune: s.lastFortune,
    coRiders: s.ride.coRiders,
    quote: 0,
    mode: s.mode,
    card: s.passCard,
    room: s.ride.roomId,
  };
}

export function TicketModal() {
  const open = useApp(s => s.ui.ticketOpen);
  if (!open) return null;
  return <TicketDialog />;
}

function TicketDialog() {
  const night = useApp(s => s.mode === 'night');
  const myNote = useApp(s => s.myNote);
  const base = useMemo(buildStats, []);
  const [quote, setQuote] = useState(() => Math.floor(Math.random() * 6));
  const [withNote, setWithNote] = useState(false);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const inApp = isInAppBrowser();

  const stats = useMemo(() => (base ? { ...base, quote: quote % QUOTES[base.mode].length } : null), [base, quote]);

  useEffect(() => {
    if (!stats) return;
    let cancelled = false;
    let objectUrl = '';
    (async () => {
      // 連線時取得簽章連結（Threads 貼上會顯示車票預覽卡）；離線時連到首頁並預選同一條線
      const url = (await bridge.game?.signTicket(stats)) ?? fallbackUrl(stats.line);
      const blob = await renderTicket({ stats, shareUrl: url, note: withNote ? myNote : null });
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setShareUrl(url);
      setImage({ blob, url: objectUrl });
    })().catch(err => {
      console.error(err);
      setMessage('車票印不出來，再試一次？');
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [stats, withNote, myNote]);

  const close = () => actions.setUi({ ticketOpen: false });
  const panel = night ? 'bg-smoke-soft text-oat' : 'bg-oat text-ink';
  const chip = night ? 'bg-white/10 hover:bg-white/20' : 'bg-ink/5 hover:bg-ink/10';
  const primary = night ? 'bg-lamp text-smoke' : 'bg-ink text-oat';

  if (!stats) {
    return (
      <div className="pointer-events-auto fixed inset-0 grid place-items-center bg-black/40 p-4" onClick={close}>
        <p className={`rounded p-4 ${panel}`}>列車還在進站，等一下再印車票。</p>
      </div>
    );
  }

  const fileName = `carriage-corner-${ticketSerial(stats)}.png`;
  const text = shareUrl ? shareText(stats, shareUrl) : '';

  const onSave = async () => {
    if (!image) return;
    const outcome = await saveImage(image.blob, fileName);
    setMessage({
      saved: '車票已存下，到 Threads 發文時記得附上。',
      downloaded: '圖片已下載，到 Threads 發文時記得附上。',
      declined: '',
      unavailable: '這裡無法直接存檔，長按上方圖片即可儲存。',
    }[outcome]);
  };
  const onShare = async () => {
    if (!image) return;
    const outcome = await shareImage(image.blob, fileName, text);
    if (outcome === 'unsupported') await onSave();
  };
  const onCopy = async () => setMessage((await copyText(text)) ? '文案已複製。' : '無法複製，請長按文字自行複製。');

  return (
    <div className="pointer-events-auto fixed inset-0 z-20 overflow-y-auto bg-black/50 p-4" onClick={close}>
      <div
        role="dialog"
        aria-label="我的車票明信片"
        className={`mx-auto flex w-full max-w-md flex-col gap-3 rounded p-4 ${panel}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">🎫 今天的車票</h2>
          <button aria-label="關閉" className={`rounded px-2 py-1 ${chip}`} onClick={close}>✕</button>
        </div>

        <div className="aspect-[4/5] w-full overflow-hidden rounded bg-black/10">
          {image ? (
            <img src={image.url} alt={`北城捷運車票，${LINES[stats.line].zh}，座位 ${stats.seat}，乘車 ${stats.minutes} 分鐘`} className="size-full" />
          ) : (
            <p className="grid size-full place-items-center opacity-70">正在印車票……</p>
          )}
        </div>
        {inApp && <p className="text-center text-xs opacity-80">長按上方圖片即可儲存，再到 Threads 發文附上。</p>}

        <div className="flex flex-wrap gap-2 text-sm">
          <button className={`rounded px-3 py-1.5 ${chip}`} onClick={() => setQuote(q => q + 1)}>🔁 換一句</button>
          {myNote && (
            <label className={`flex cursor-pointer items-center gap-1.5 rounded px-3 py-1.5 ${chip}`}>
              <input type="checkbox" checked={withNote} onChange={e => setWithNote(e.target.checked)} />
              附上我寫在車窗上的話
            </label>
          )}
        </div>
        {myNote && withNote && <p className="text-xs opacity-70">車窗上的話只會印在這張圖上，不會出現在公開連結裡。</p>}

        <div className="grid grid-cols-2 gap-2">
          {ARTIFACT && (
            <button disabled={!image} className={`col-span-2 rounded px-3 py-2 disabled:opacity-40 ${primary}`} onClick={() => void onSave()}>
              存下車票
            </button>
          )}
          {!ARTIFACT && !inApp && (
            <button disabled={!image} className={`col-span-2 rounded px-3 py-2 disabled:opacity-40 ${primary}`} onClick={() => void onShare()}>
              分享車票
            </button>
          )}
          {!ARTIFACT && !inApp && (
            <button disabled={!image} className={`rounded px-3 py-2 disabled:opacity-40 ${chip}`} onClick={() => void onSave()}>
              下載圖片
            </button>
          )}
          <button disabled={!shareUrl} className={`rounded px-3 py-2 disabled:opacity-40 ${chip}`} onClick={() => void onCopy()}>
            複製文案
          </button>
          <a
            href={shareUrl ? threadsIntentUrl(text) : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!shareUrl}
            className={`rounded px-3 py-2 text-center ${chip} ${inApp || ARTIFACT ? '' : 'col-span-2'} ${shareUrl ? '' : 'pointer-events-none opacity-40'}`}
          >
            到 Threads 發文
          </a>
        </div>
        <p aria-live="polite" className="min-h-4 text-center text-xs opacity-80">{message}</p>
      </div>
    </div>
  );
}
