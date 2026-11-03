import './styles.css';
import { looksLikeContact, tidyName, type AvatarId, type Gender, type LineId, type PassCardId } from '@cc/shared';
import { mixer } from './audio/AmbientMixer';
import { devParams, modeForHour, store } from './store';

// 玩家在閘門選路線、選卡面的這幾秒，背景先把場景與 HUD 模組載好（docs/PRD.md §6.5）
const gameModule = import('./game/boot');
const hudModule = import('./ui/mountHud');
// Artifact 靜態版沒有即時伺服器：不嘗試連線，直接用離線模式，進站不必等逾時
const REALTIME = import.meta.env.VITE_TARGET !== 'artifact';
const netModule = REALTIME ? import('./net/session') : null;

const gate = document.getElementById('gate')!;
const boardButton = document.getElementById('board') as HTMLButtonElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const nameError = document.getElementById('name-error')!;

// 記住上次的名字與性別（只存在這台裝置）
const PROFILE_KEY = 'cc.profile';
try {
  const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as { name?: string; gender?: Gender } | null;
  if (saved?.name) nameInput.value = saved.name;
  if (saved?.gender === 'm' || saved?.gender === 'f') {
    store.setState({ gender: saved.gender });
    gate.querySelectorAll('[data-group="gender"] button').forEach(b =>
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.value === saved.gender)),
    );
  }
} catch { /* 沒有就算了 */ }

nameInput.addEventListener('input', () => (nameError.textContent = ''));
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) boardButton.click();
});

/** 名字留白就請對方填；看起來像聯絡方式的不收 */
function readName(): string | null {
  const name = tidyName(nameInput.value);
  if (!name) {
    nameError.textContent = '先取個名字吧，會顯示在你的頭上。';
    nameInput.focus();
    return null;
  }
  if (looksLikeContact(name)) {
    nameError.textContent = '名字裡不能放聯絡方式喔。';
    nameInput.focus();
    return null;
  }
  return name;
}

for (const group of gate.querySelectorAll<HTMLElement>('[data-group]')) {
  group.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
    if (!button) return;
    group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    const value = button.dataset.value!;
    const key = group.dataset.group as 'line' | 'gender' | 'avatar' | 'passCard';
    if (key === 'line') store.setState({ line: value as LineId });
    if (key === 'gender') store.setState({ gender: value as Gender });
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
  const name = readName();
  if (!name) return;
  // 必須在點擊事件內同步呼叫，瀏覽器才允許出聲
  void mixer.unlock();
  boardButton.disabled = true;
  boardButton.textContent = '嗶！走進月台……';
  store.setState({ name });
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, gender: store.getState().gender }));
  } catch { /* 無痕模式 */ }
  try {
    // 連線與模組下載同時進行；連不上伺服器時 net 為 null，改用離線模式
    const [{ boot }, { mountHud }, net] = await Promise.all([
      gameModule,
      hudModule,
      netModule ? netModule.then(m => m.connect()) : null,
    ]);
    await boot(document.getElementById('stage')!, net);
    mountHud(document.getElementById('hud')!);
    store.setState({ boarded: true });
    gate.classList.add('gate--leaving');
  } catch (err) {
    console.error(err);
    boardButton.disabled = false;
    boardButton.textContent = '閘門暫時打不開，再感應一次';
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
