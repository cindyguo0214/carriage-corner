// 環境音混音器：原生 Web Audio 音訊圖（docs/PRD.md §9.4）
// M0：三條循環由 procedural.ts 即時合成；正式版換成 CC0 錄音（loadBuffer 以檔案取代 make）。
import type { Segment } from '@cc/shared';
import { synthLofi, synthRail, synthRain } from './procedural';

export type Channel = 'rail' | 'rain' | 'lofi'; // 使用者看到的三個推桿

const LOOPS: Record<Channel, { make: (ctx: AudioContext) => AudioBuffer | Promise<AudioBuffer>; gain: number }> = {
  rail: { make: synthRail, gain: 0.6 },
  rain: { make: synthRain, gain: 0.45 },
  lofi: { make: ctx => synthLofi(ctx.sampleRate), gain: 0.35 },
};

// 鐵軌聲低通截止頻率：地下悶、高架亮——同一段素材演繹兩種空間
const RAIL_CUTOFF = { underground: 700, elevated: 4500 } as const;

const SFX_GAIN = 0.126; // ≈ -18 dBFS
const STORAGE_KEY = 'cc.mixer.v2';

export interface MixerSettings {
  on: Record<Channel, boolean>;
  level: Record<Channel, number>;
  master: number;
}

type Listener = (s: MixerSettings) => void;

export class AmbientMixer {
  private ctx: AudioContext | null = null;
  private buses = {} as Record<Channel | 'sfx', GainNode>;
  private master!: GainNode;
  private railFilter!: BiquadFilterNode;
  private sfxTone!: BiquadFilterNode;
  private sources = new Map<Channel, AudioBufferSourceNode>();
  private buffers = new Map<Channel, Promise<AudioBuffer>>();
  private settings: MixerSettings = {
    on: { rail: true, rain: false, lofi: false },
    level: { rail: 1, rain: 0.8, lofi: 0.8 },
    master: 0.8,
  };
  private segment: keyof typeof RAIL_CUTOFF = 'underground';
  private ducked = false;
  private duckTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<Listener>();

  constructor() {
    this.restore();
  }

  get state(): MixerSettings {
    return this.settings;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** ⚠️ 必須在使用者手勢（感應進站按鈕的 onClick）中呼叫，否則瀏覽器會擋下自動播放 */
  async unlock(): Promise<void> {
    // iOS Safari 16.4+：讓 Web Audio 在靜音開關打開時仍能出聲
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';

    if (!this.ctx) this.buildGraph();
    this.playGateBeep(); // 「嗶」——同步排程，落在手勢期間內
    await this.resumeIfNeeded();
    await Promise.all((Object.keys(LOOPS) as Channel[]).map(ch => this.apply(ch, 2.5)));
  }

  /** iOS 來電、切換 App 後 AudioContext 會被暫停；回到前景時呼叫 */
  async resumeIfNeeded() {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
  }

  setChannel(ch: Channel, enabled: boolean) {
    this.settings = { ...this.settings, on: { ...this.settings.on, [ch]: enabled } };
    this.changed();
    return this.apply(ch);
  }

  setLevel(ch: Channel, value: number) {
    this.settings = { ...this.settings, level: { ...this.settings.level, [ch]: clamp01(value) } };
    this.changed();
    return this.apply(ch, 0.15);
  }

  setMaster(value: number) {
    this.settings = { ...this.settings, master: clamp01(value) };
    this.changed();
    if (this.ctx) this.ramp(this.master.gain, this.settings.master, 0.15);
  }

  /** 列車區段改變：只滑動鐵軌聲的低通截止頻率，約 3 秒完成，模擬出入隧道 */
  setSegment(seg: Segment) {
    const next = seg === 'portal_up' ? 'elevated' : seg === 'portal_down' ? 'underground' : seg;
    if (next === this.segment) return;
    this.segment = next;
    if (this.ctx) this.ramp(this.railFilter.frequency, RAIL_CUTOFF[next], 3);
  }

  /** 關門警示音：800 Hz ⇄ 1000 Hz 簡短交替，全程即時合成，不使用任何錄音 */
  playDoorChime(beeps = 8, beepMs = 150, gapMs = 30) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + 0.05;
    for (let i = 0; i < beeps; i++) {
      this.beep(i % 2 === 0 ? 800 : 1000, t0 + (i * (beepMs + gapMs)) / 1000, beepMs / 1000);
    }
    this.duck(beeps * (beepMs + gapMs) + 600);
  }

  playGateBeep() {
    if (this.ctx) this.beep(1200, this.ctx.currentTime + 0.01, 0.09);
  }

  /** 穿過車廂連接處：拉開通道門的「咔」、一陣風聲掃過、再「咔」一聲關上（全部即時合成） */
  playGangway() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const len = 1.1;
    const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = new AudioBufferSourceNode(ctx, { buffer: noise });
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 300, Q: 0.8 });
    const env = new GainNode(ctx, { gain: 0 });
    src.connect(band).connect(env).connect(this.buses.sfx);
    band.frequency.setValueAtTime(300, t);
    band.frequency.exponentialRampToValueAtTime(1600, t + 0.45);
    band.frequency.exponentialRampToValueAtTime(400, t + len);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1.6, t + 0.35);
    env.gain.linearRampToValueAtTime(0, t + len);
    src.start(t);
    src.stop(t + len);
    src.onended = () => env.disconnect();
    // 門閂的低沉「咔」聲
    for (const at of [t, t + len - 0.12]) {
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: 140 });
      const g = new GainNode(ctx, { gain: 0 });
      osc.connect(g).connect(this.buses.sfx);
      osc.frequency.setValueAtTime(140, at);
      osc.frequency.exponentialRampToValueAtTime(60, at + 0.08);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1.2, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
      osc.start(at);
      osc.stop(at + 0.12);
      osc.onended = () => g.disconnect();
    }
    this.duck(len * 1000 + 300);
  }

  playPomodoroBell() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    this.beep(880, t, 0.5);
    this.beep(1320, t + 0.18, 0.7);
  }

  private buildGraph() {
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'playback' }));
    this.master = new GainNode(ctx, { gain: this.settings.master });
    this.master.connect(ctx.destination);

    for (const name of ['rail', 'rain', 'lofi', 'sfx'] as const) {
      this.buses[name] = new GainNode(ctx, { gain: 0 });
    }

    // 鐵軌：Bus → 低通 → Master（只有鐵軌聲經過這個濾鏡）
    this.railFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: RAIL_CUTOFF[this.segment], Q: 0.7 });
    this.buses.rail.connect(this.railFilter).connect(this.master);

    // 雨聲：去掉低頻轟鳴
    this.buses.rain.connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 120 })).connect(this.master);

    this.buses.lofi.connect(this.master);

    // 合成提示音：低通 2.5 kHz 磨圓三角波的稜角
    this.buses.sfx.gain.value = SFX_GAIN;
    this.sfxTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2500 });
    this.sfxTone.connect(this.buses.sfx).connect(this.master);
  }

  /** 單一短音：5 ms 起音／釋音，避免爆音 */
  private beep(freq: number, at: number, len: number) {
    const ctx = this.ctx!;
    const osc = new OscillatorNode(ctx, { type: 'triangle', frequency: freq });
    const env = new GainNode(ctx, { gain: 0 });
    osc.connect(env).connect(this.sfxTone);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + 0.005);
    env.gain.setValueAtTime(1, at + len - 0.005);
    env.gain.linearRampToValueAtTime(0, at + len);
    osc.start(at);
    osc.stop(at + len + 0.01);
    osc.onended = () => env.disconnect();
  }

  /** 依目前狀態把頻道推到目標音量；第一次需要出聲時才產生（或下載）音訊 */
  private async apply(ch: Channel, rampSec = 1.5) {
    if (!this.ctx) return;
    if (this.target(ch) > 0 && !this.sources.has(ch)) {
      try {
        await this.ensureSource(ch);
      } catch (err) {
        console.warn(err); // 環境音載入失敗不影響其他功能
        return;
      }
    }
    this.ramp(this.buses[ch].gain, this.target(ch), rampSec); // 載入期間設定可能已變，重新計算
  }

  private async ensureSource(ch: Channel) {
    let p = this.buffers.get(ch);
    if (!p) {
      p = Promise.resolve(LOOPS[ch].make(this.ctx!));
      p.catch(() => this.buffers.delete(ch));
      this.buffers.set(ch, p);
    }
    const buffer = await p;
    if (this.sources.has(ch)) return; // 並行呼叫時只啟動一次
    // AudioBufferSourceNode 原生循環是樣本級無縫
    const src = new AudioBufferSourceNode(this.ctx!, { buffer, loop: true });
    src.connect(this.buses[ch]);
    src.start();
    this.sources.set(ch, src);
  }

  private target(ch: Channel): number {
    if (!this.settings.on[ch]) return 0;
    const duck = ch === 'lofi' && this.ducked ? 0.4 : 1;
    return LOOPS[ch].gain * this.settings.level[ch] * duck;
  }

  private duck(ms: number) {
    this.ducked = true;
    void this.apply('lofi', 0.3);
    clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => {
      this.ducked = false;
      void this.apply('lofi', 1.2);
    }, ms);
  }

  /** 從「目前的值」平滑過渡到目標（rampSec 內完成約 95%） */
  private ramp(param: AudioParam, value: number, rampSec: number) {
    const t = this.ctx!.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.setTargetAtTime(value, t, rampSec / 3);
  }

  private changed() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* 無痕模式或儲存被封鎖：不影響播放 */
    }
    this.listeners.forEach(fn => fn(this.settings));
  }

  private restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<MixerSettings> | null;
      if (saved?.on && saved.level) {
        this.settings = {
          on: { ...this.settings.on, ...saved.on },
          level: { ...this.settings.level, ...saved.level },
          master: typeof saved.master === 'number' ? saved.master : this.settings.master,
        };
      }
    } catch {
      /* 使用預設值 */
    }
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const mixer = new AmbientMixer();
