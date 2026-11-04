// 隨身聽情境面板（docs/PRD.md 第 22 章）：坐著切到「聽音樂」時出現，選四種情境音樂
import { useEffect, useSyncExternalStore } from 'react';
import { mixer } from '../audio/AmbientMixer';
import { MOODS, moodOf, type Mood } from '../audio/moods';
import { bridge } from '../gameBridge';
import { actions, store, useApp, type AppState } from '../store';

/** 情境圖示在頭上停留的時間 */
const POP_MS = 2000;

const listening = (s: AppState) => s.scene === 'carriage' && s.selfState === 'music' && !s.selfSeat?.startsWith('S');

/**
 * 坐著切到聽音樂就開始播、切走或下車就淡出。
 * store 的通知是同步的，所以開始播放仍在點擊手勢裡（iOS 的 <audio> 需要）。
 */
export function useMoodMusic() {
  useEffect(() => {
    mixer.setMusicActive(listening(store.getState()));
    return store.subscribe((s, prev) => {
      const on = listening(s);
      if (on === listening(prev)) return;
      mixer.setMusicActive(on);
      if (on) {
        actions.setUi({ walkman: true, mixerOpen: false });
        bridge.game?.popSelf(moodOf(mixer.moodState.mood).icon, POP_MS);
      }
    });
  }, []);
}

export function Walkman() {
  const show = useApp(listening);
  const open = useApp(s => s.ui.walkman);
  const night = useApp(s => s.mode === 'night');
  const settings = useSyncExternalStore(fn => mixer.subscribeMood(fn), () => mixer.moodState);
  if (!show) return null;
  const track = moodOf(settings.mood);

  const pick = (mood: Mood) => {
    if (mood === settings.mood) return;
    mixer.playTick();
    mixer.setMood(mood);
    bridge.game?.popSelf(moodOf(mood).icon, POP_MS);
  };

  if (!open) {
    return (
      <button className="walkman-chip" aria-label={`展開隨身聽，正在播放${track.zh}`} onClick={() => actions.setUi({ walkman: true })}>
        <i className="walkman__reel" aria-hidden />
        <span aria-hidden>{track.icon}</span>
        {track.zh}
      </button>
    );
  }

  return (
    <section className="walkman" data-night={night} aria-label="隨身聽：情境音樂">
      <div className="walkman__top">
        <i className="walkman__led" aria-hidden />
        CC-01 隨身聽
        <button className="walkman__fold" aria-label="收起隨身聽" onClick={() => actions.setUi({ walkman: false })}>–</button>
      </div>
      <div className="walkman__window">
        <i className="walkman__reel" aria-hidden />
        <p className="walkman__label" aria-live="polite">
          <b>{track.icon} {track.zh} {track.en}</b>
          <small>♪ {track.title} — {track.artist}</small>
        </p>
        <i className="walkman__reel" aria-hidden />
      </div>
      <div className="walkman__keys" role="radiogroup" aria-label="情境">
        {MOODS.map(m => (
          <button
            key={m.id}
            role="radio"
            aria-checked={m.id === settings.mood}
            title={`${m.zh}：${m.hint}`}
            className="walkman__key"
            onClick={() => pick(m.id)}
          >
            <span aria-hidden>{m.icon}</span>
            {m.zh}
          </button>
        ))}
      </div>
      <label className="walkman__vol">
        <span aria-hidden>🔉</span>
        <span className="sr-only">情境音樂音量</span>
        <input type="range" min={0} max={1} step={0.01} value={settings.level} onChange={e => mixer.setMoodLevel(Number(e.target.value))} />
      </label>
      <p className="walkman__credit">曲目來自 YouTube 音效庫</p>
    </section>
  );
}
