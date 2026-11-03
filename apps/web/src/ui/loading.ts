// 過場載入畫面：開網頁、走進月台、上下車、換車廂時蓋住畫面（docs/PRD.md 第 16 章）
// 外觀與動畫寫在 index.html（JS 載入前就要顯示），這裡只負責開關與換字。

const TIPS = [
  'TPRT 提示：車廂內禁止飲食，口渴的話到月台再喝吧。',
  'TPRT 提示：列車進站時，請站在黃線後方。',
  'TPRT 提示：博愛座請留給更需要的人。',
  'TPRT 提示：到站開門時，點車門就能下車。',
  'TPRT 提示：點車廂兩端的通道門，可以走到隔壁車廂。',
  'TPRT 提示：車窗起霧時，點一下就能在上面寫一句話。',
  'TPRT 提示：累了就補個眠，到站會叫你。',
];

const el = () => document.getElementById('loading');
let shownAt = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export const loading = {
  /** title 是大字（例如「正在切換至第 3 車廂」），tip 不給就隨機挑一句 TPRT 提示 */
  show(title: string, tip?: string, lineColor?: string) {
    const root = el();
    if (!root) return;
    clearTimeout(hideTimer);
    document.getElementById('loading-title')!.textContent = title;
    document.getElementById('loading-tip')!.textContent = tip ?? TIPS[Math.floor(Math.random() * TIPS.length)];
    if (lineColor) root.style.setProperty('--train', lineColor);
    if (!root.classList.contains('loading--on')) shownAt = performance.now();
    root.classList.add('loading--on');
  },

  /** 至少顯示 minMs，避免一閃而過 */
  hide(minMs = 0) {
    const wait = Math.max(0, shownAt + minMs - performance.now());
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el()?.classList.remove('loading--on'), wait);
    return new Promise<void>(resolve => setTimeout(resolve, wait));
  },

  /** 顯示載入畫面直到 task 完成（且至少 minMs）；task 失敗時也會收起 */
  async during<T>(title: string, task: Promise<T>, opts: { tip?: string; lineColor?: string; minMs?: number } = {}): Promise<T> {
    loading.show(title, opts.tip, opts.lineColor);
    const minMs = opts.minMs ?? 900;
    try {
      const result = await task;
      await new Promise(r => setTimeout(r, Math.max(0, shownAt + minMs - performance.now())));
      return result;
    } finally {
      void loading.hide();
    }
  },

  markShown() {
    shownAt = performance.now();
  },
};
