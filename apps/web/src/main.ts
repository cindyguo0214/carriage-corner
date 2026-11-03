import './styles.css';
import type { AvatarId, LineId, PassCardId } from '@cc/shared';
import { mixer } from './audio/AmbientMixer';
import { devParams, modeForHour, store } from './store';

// 玩家在閘門選路線、選卡面的這幾秒，背景先把場景與 HUD 模組載好（docs/PRD.md §6.5）
const gameModule = import('./game/boot');
const hudModule = import('./ui/mountHud');
const netModule = import('./net/session');

const gate = document.getElementById('gate')!;
const boardButton = document.getElementById('board') as HTMLButtonElement;

for (const group of gate.querySelectorAll<HTMLElement>('[data-group]')) {
  group.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
    if (!button) return;
    group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    const value = button.dataset.value!;
    const key = group.dataset.group as 'line' | 'avatar' | 'passCard';
    if (key === 'line') store.setState({ line: value as LineId });
    if (key === 'avatar') store.setState({ avatar: value as AvatarId });
    if (key === 'passCard') store.setState({ passCard: value as PassCardId });
  });
}

// 從車票落地頁「搭上同一條線」進來時預選路線
const presetLine = new URLSearchParams(location.search).get('line');
if (presetLine === 'CX' || presetLine === 'RV' || presetLine === 'SK') {
  store.setState({ line: presetLine });
  gate.querySelectorAll('[data-group="line"] button').forEach(b =>
    b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.value === presetLine)),
  );
}

boardButton.addEventListener('click', async () => {
  // 必須在點擊事件內同步呼叫，瀏覽器才允許出聲
  void mixer.unlock();
  boardButton.disabled = true;
  boardButton.textContent = '嗶！列車進站中……';
  try {
    const { line, avatar, passCard } = store.getState();
    // 連線與模組下載同時進行；連不上伺服器時 session 為 null，改用離線模式
    const [{ boot }, { mountHud }, session] = await Promise.all([
      gameModule,
      hudModule,
      netModule.then(m => m.connectAndBoard({ line, avatar, passCard })),
    ]);
    await boot(document.getElementById('stage')!, session);
    mountHud(document.getElementById('hud')!);
    store.setState({ boarded: true });
    gate.classList.add('gate--leaving');
  } catch (err) {
    console.error(err);
    boardButton.disabled = false;
    boardButton.textContent = '列車暫時無法進站，再感應一次';
  }
});

// 雨聲開啟時，車窗也同步下雨
store.setState({ rain: mixer.state.on.rain });
mixer.subscribe(s => {
  if (s.on.rain !== store.getState().rain) store.setState({ rain: s.on.rain });
});

// 依真實時間切換晨／夜（網址帶 ?mode= 時固定不切）
if (!new URLSearchParams(location.search).has('mode')) {
  setInterval(() => {
    const mode = modeForHour(new Date().getHours());
    if (mode !== store.getState().mode) store.setState({ mode });
  }, 60_000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void mixer.resumeIfNeeded();
});

if (devParams.dev) Object.assign(window, { store, mixer });
