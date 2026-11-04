import './styles.css';
import {
  LINES, looksLikeContact, stationIsUnderground, tidyName,
  type AvatarId, type Gender, type LineId, type PassCardId,
} from '@cc/shared';
import { mixer } from './audio/AmbientMixer';
import { devParams, modeForHour, store } from './store';
import { loading } from './ui/loading';

// 玩家在閘門選路線、選卡面的這幾秒，背景先把場景與 HUD 模組載好（docs/PRD.md §6.5）
const gameModule = import('./game/boot');
const hudModule = import('./ui/mountHud');
// Artifact 靜態版沒有即時伺服器：不嘗試連線，直接用離線模式，進站不必等逾時
const REALTIME = import.meta.env.VITE_TARGET !== 'artifact';
const netModule = REALTIME ? import('./net/session') : null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const gate = $('gate');
const card = gate.querySelector<HTMLElement>('.gate__card')!;
const step1 = $('step-1');
const step2 = $('step-2');
const previewName = $('preview-name');
const previewSprite = $<HTMLCanvasElement>('preview-sprite');
const nextButton = $<HTMLButtonElement>('next');
const backButton = $<HTMLButtonElement>('back');
const boardButton = $<HTMLButtonElement>('board');
const nameInput = $<HTMLInputElement>('name');
const nameError = $('name-error');
const toStep1 = $<HTMLButtonElement>('to-step-1');
const route = $<HTMLOListElement>('route');

// 開網頁的載入畫面：等場景模組下載（最多 2.5 秒），至少顯示 0.9 秒
loading.markShown();
void Promise.race([Promise.all([gameModule, hudModule]), new Promise(r => setTimeout(r, 2500))])
  .catch(() => {})
  .then(() => loading.hide(900));

// 記住上次的名字與性別（只存在這台裝置）
const PROFILE_KEY = 'cc.profile';
const press = (group: string, value: string) =>
  gate.querySelectorAll(`[data-group="${group}"] button`).forEach(b =>
    b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.value === value)),
  );
try {
  const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as { name?: string; gender?: Gender } | null;
  if (saved?.name) nameInput.value = saved.name;
  if (saved?.gender === 'm' || saved?.gender === 'f') {
    store.setState({ gender: saved.gender });
    press('gender', saved.gender);
  }
} catch { /* 沒有就算了 */ }

// ── 角色預覽：名字、外觀與穿搭即時反映（用遊戲裡同一套角色畫法） ──
const charactersModule = import('./game/characters');
void charactersModule.then(m => m.previewArtReady).then(() => renderPreview());
let previewFrame = 0;
function renderPreview() {
  const name = tidyName(nameInput.value);
  previewName.textContent = name || '你的名字';
  previewName.classList.toggle('preview__name--empty', !name);
  void charactersModule.then(({ paintPreview }) => {
    const { avatar, gender, mode } = store.getState();
    paintPreview(previewSprite.getContext('2d')!, avatar, gender, mode, previewFrame);
  });
}
// 站著輕輕呼吸；減少動態效果時不動
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  setInterval(() => {
    if (store.getState().boarded || step1.hidden) return;
    previewFrame = 1 - previewFrame;
    renderPreview();
  }, 800);
}

nameInput.addEventListener('input', () => {
  nameError.textContent = '';
  renderPreview();
});
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) nextButton.click();
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
    if (key === 'line') selectLine(value as LineId);
    if (key === 'gender') store.setState({ gender: value as Gender });
    if (key === 'avatar') store.setState({ avatar: value as AvatarId });
    if (key === 'gender' || key === 'avatar') renderPreview();
    if (key === 'passCard') store.setState({ passCard: value as PassCardId });
  });
}

// ── 第 1 步 ⇄ 第 2 步 ──
function showStep(n: 1 | 2) {
  step1.hidden = n !== 1;
  step2.hidden = n !== 2;
  card.dataset.step = String(n);
  toStep1.disabled = n === 1;
  gate.scrollTop = 0;
  (n === 1 ? nameInput : gate.querySelector<HTMLButtonElement>('[data-group="line"] [aria-pressed="true"]'))?.focus();
}

nextButton.addEventListener('click', () => {
  const name = readName();
  if (!name) return;
  store.setState({ name });
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, gender: store.getState().gender }));
  } catch { /* 無痕模式 */ }
  showStep(2);
});
backButton.addEventListener('click', () => showStep(1));
toStep1.addEventListener('click', () => showStep(1));

// ── 路線圖：選路線後列出車站，點一站作為進站車站 ──
function selectLine(line: LineId) {
  if (store.getState().line !== line) store.setState({ line, station: null });
  press('line', line);
  renderRoute();
}

function renderRoute() {
  const { line: lineId, station } = store.getState();
  const line = LINES[lineId];
  route.style.setProperty('--route', line.color);
  route.replaceChildren(
    ...line.stations.map((s, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stop';
      b.setAttribute('aria-pressed', String(i === station));
      const ground = stationIsUnderground(line, i) ? '地下站' : '高架站';
      const xfer = (s.transfer ?? [])
        .map(t => `<span class="stop__xfer" style="background:${LINES[t].color}">轉 ${LINES[t].zh}</span>`)
        .join('');
      b.innerHTML =
        `<span class="stop__dot" aria-hidden="true"></span>` +
        `<span class="stop__name"><span class="stop__zh"></span><span class="stop__en"></span></span>` +
        `<span class="stop__meta">${xfer}<span>${s.code}・${ground}</span></span>`;
      b.querySelector('.stop__zh')!.textContent = s.zh;
      b.querySelector('.stop__en')!.textContent = s.en;
      b.addEventListener('click', () => {
        store.setState({ station: i });
        renderRoute();
        route.querySelectorAll<HTMLButtonElement>('.stop')[i]?.focus();
      });
      li.appendChild(b);
      return li;
    }),
  );
  boardButton.disabled = station === null;
  boardButton.textContent = station === null ? '先點一個車站' : `嗶！從${line.stations[station].zh}進站`;
}

// 從車票落地頁「搭上同一條線」進來時預選路線；開發時可用 ?station= 預選車站
const params = new URLSearchParams(location.search);
const presetLine = params.get('line');
if (presetLine === 'CX' || presetLine === 'RV' || presetLine === 'SK') store.setState({ line: presetLine });
const presetStation = Number(params.get('station'));
if (presetStation >= 1 && presetStation <= LINES[store.getState().line].stations.length) store.setState({ station: presetStation - 1 });
selectLine(store.getState().line);
renderPreview();
toStep1.disabled = true;

boardButton.addEventListener('click', async () => {
  const { line, station } = store.getState();
  if (station === null) return;
  // 必須在點擊事件內同步呼叫，瀏覽器才允許出聲
  void mixer.unlock();
  boardButton.disabled = true;
  const stationName = LINES[line].stations[station].zh;
  try {
    // 連線與模組下載同時進行；連不上伺服器時 net 為 null，改用離線模式
    await loading.during(
      `正在走進${stationName}月台`,
      (async () => {
        const [{ boot }, { mountHud }, net] = await Promise.all([
          gameModule,
          hudModule,
          netModule ? netModule.then(m => m.connect()) : null,
        ]);
        await boot(document.getElementById('stage')!, net);
        mountHud(document.getElementById('hud')!);
      })(),
      { lineColor: LINES[line].color, minMs: 1200 },
    );
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
if (!params.has('mode')) {
  setInterval(() => {
    const mode = modeForHour(new Date().getHours());
    if (mode !== store.getState().mode) store.setState({ mode });
  }, 60_000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void mixer.resumeIfNeeded();
});

if (devParams.dev) Object.assign(window, { store, mixer });
