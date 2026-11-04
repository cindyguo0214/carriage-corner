// 環境音混音器：原生 Web Audio 音訊圖（docs/PRD.md §9.4）；聽音樂時的情境音樂見第 22 章
// M0：三條循環由 procedural.ts 即時合成；正式版換成 CC0 錄音（loadBuffer 以檔案取代 make）。
import type { Segment } from '@cc/shared';
import { MOODS, type Mood } from './moods';
import { synthLofi, synthRail, synthRain } from './procedural';

export type Channel = 'rail' | 'rain' | 'lofi'; // 使用者看到的三個推桿

const LOOPS: Record<Channel, { make: (ctx: AudioContext) => AudioBuffer | Promise<AudioBuffer>; gain: number }> = {
  rail: { make: synthRail, gain: 0.42 },
  rain: { make: synthRain, gain: 0.32 },
  lofi: { make: ctx => synthLofi(ctx.sampleRate), gain: 0.25 },
};

// 鐵軌聲低通截止頻率：地下悶、高架亮——同一段素材演繹兩種空間
const RAIL_CUTOFF = { underground: 700, elevated: 4500 } as const;

const SFX_GAIN = 0.089; // ≈ -21 dBFS
const STORAGE_KEY = 'cc.mixer.v2';
const MOOD_KEY = 'cc.mood.v1';
/** 情境音樂的基準音量與切換時的淡入淡出秒數 */
const MOOD_GAIN = 0.35;
const MOOD_FADE_SEC = 1.5;
/** 聽情境音樂時，鐵軌行駛聲壓到原本的這個比例，讓音樂在前面 */
const RAIL_UNDER_MUSIC = 0.35;

export interface MixerSettings {
  on: Record<Channel, boolean>;
  level: Record<Channel, number>;
  master: number;
}

type Listener = (s: MixerSettings) => void;

export interface MoodSettings {
  mood: Mood;
  level: number;
  /** 正在聽（坐著、狀態是聽音樂） */
  active: boolean;
}
type MoodListener = (s: MoodSettings) => void;

/** 一首情境音樂：串流播放的 <audio>，接進 Web Audio 音訊圖，用自己的 GainNode 淡入淡出 */
interface MoodVoice {
  el: HTMLAudioElement;
  gain: GainNode;
  pauseTimer?: ReturnType<typeof setTimeout>;
}

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
  private moodSettings: MoodSettings = { mood: 'calm', level: 0.8, active: false };
  private moodListeners = new Set<MoodListener>();
  private voices = new Map<Mood, MoodVoice>();
  private moodBus: GainNode | null = null;

  constructor() {
    this.restore();
    this.restoreMood();
  }

  get state(): MixerSettings {
    return this.settings;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get moodState(): MoodSettings {
    return this.moodSettings;
  }

  subscribeMood(fn: MoodListener) {
    this.moodListeners.add(fn);
    return () => this.moodListeners.delete(fn);
  }

  /** 切換情境：舊的在 1.5 秒內淡出、新的同時淡入；選擇記在這台裝置 */
  setMood(mood: Mood) {
    if (mood === this.moodSettings.mood) return;
    this.moodSettings = { ...this.moodSettings, mood };
    this.moodChanged();
    this.applyMood(MOOD_FADE_SEC);
  }

  setMoodLevel(value: number) {
    this.moodSettings = { ...this.moodSettings, level: clamp01(value) };
    this.moodChanged();
    this.applyMood(0.15);
  }

  /**
   * 開始／停止聽情境音樂（坐著切到「聽音樂」時開始）。
   * ⚠️ 開始時要在使用者手勢裡呼叫：iOS 的 <audio> 第一次播放需要手勢。
   */
  setMusicActive(active: boolean) {
    if (active === this.moodSettings.active) return;
    this.moodSettings = { ...this.moodSettings, active };
    this.moodChanged();
    this.applyMood(MOOD_FADE_SEC);
    // 情境音樂播放時，合成的 Lo-Fi 鋼琴先停（避免兩段音樂疊在一起），鐵軌聲退到後面
    void this.apply('lofi', MOOD_FADE_SEC);
    void this.apply('rail', MOOD_FADE_SEC);
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

  /** 走過轉乘連通道：先一段車站廣播鈴（原創的四音上行），再一串在通道裡回響的腳步聲（全部即時合成） */
  playTransfer() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.03;
    [659, 784, 988, 1319].forEach((f, i) => this.beep(f, t + i * 0.16, i === 3 ? 0.42 : 0.14));
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const at = t + 0.95 + i * 0.27 + (i % 2) * 0.02;
      for (const [delay, gain] of [[0, 0.9], [0.09, 0.25]] as const) {
        const len = 0.07;
        const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let k = 0; k < data.length; k++) data[k] = (Math.random() * 2 - 1) * (1 - k / data.length) ** 3;
        const src = new AudioBufferSourceNode(ctx, { buffer: buf });
        const low = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: i % 2 ? 520 : 600 });
        // 越走越遠：腳步聲慢慢變小
        const g = new GainNode(ctx, { gain: gain * (1.6 - i / steps) });
        src.connect(low).connect(g).connect(this.buses.sfx);
        src.start(at + delay);
        src.onended = () => g.disconnect();
      }
    }
    this.duck(3600);
  }

  /** 輪盤選單：滑過扇形時很輕的「喀」 */
  playTick() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + 0.005;
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: 2200 });
    const g = new GainNode(ctx, { gain: 0 });
    osc.connect(g).connect(this.buses.sfx);
    osc.frequency.exponentialRampToValueAtTime(900, at + 0.03);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.18, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    osc.start(at);
    osc.stop(at + 0.05);
    osc.onended = () => g.disconnect();
  }

  /** 嗶卡默契：比進站閘門短一點、亮一點的「嗶」 */
  playCardBeep() {
    if (!this.ctx) return;
    this.beep(1480, this.ctx.currentTime + 0.01, 0.11);
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

    // 情境音樂：每首自己的 GainNode → 情境 Bus → Master（關門警示音時一起壓低）
    this.moodBus = new GainNode(ctx, { gain: 1 });
    this.moodBus.connect(this.master);

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
    if (ch === 'lofi' && this.moodSettings.active) return 0;
    const duck = ch === 'lofi' && this.ducked ? 0.4 : 1;
    const under = ch === 'rail' && this.moodSettings.active ? RAIL_UNDER_MUSIC : 1;
    return LOOPS[ch].gain * this.settings.level[ch] * duck * under;
  }

  private duck(ms: number) {
    this.ducked = true;
    void this.apply('lofi', 0.3);
    if (this.moodBus) this.ramp(this.moodBus.gain, 0.4, 0.3);
    clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => {
      this.ducked = false;
      void this.apply('lofi', 1.2);
      if (this.moodBus) this.ramp(this.moodBus.gain, 1, 1.2);
    }, ms);
  }

  /** 把每首情境音樂推到目標音量：正在聽的那首淡入並播放，其他淡出，淡完才暫停 */
  private applyMood(rampSec: number) {
    if (!this.ctx || !this.moodBus) return;
    const { mood, level, active } = this.moodSettings;
    for (const track of MOODS) {
      const on = active && track.id === mood;
      let voice = this.voices.get(track.id);
      if (!voice && !on) continue;
      if (!voice) {
        const el = new Audio();
        el.src = track.url;
        el.loop = true;
        el.preload = 'auto';
        const gain = new GainNode(this.ctx, { gain: 0 });
        new MediaElementAudioSourceNode(this.ctx, { mediaElement: el }).connect(gain).connect(this.moodBus);
        voice = { el, gain };
        this.voices.set(track.id, voice);
      }
      clearTimeout(voice.pauseTimer);
      if (on) {
        void voice.el.play().catch(err => console.warn(err)); // 載入或自動播放被擋：不影響其他聲音
        this.ramp(voice.gain.gain, MOOD_GAIN * level, rampSec);
      } else {
        this.ramp(voice.gain.gain, 0, rampSec);
        const el = voice.el;
        voice.pauseTimer = setTimeout(() => el.pause(), rampSec * 1000 + 200);
      }
    }
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

  private moodChanged() {
    const { mood, level } = this.moodSettings;
    try {
      localStorage.setItem(MOOD_KEY, JSON.stringify({ mood, level }));
    } catch {
      /* 無痕模式或儲存被封鎖：不影響播放 */
    }
    this.moodListeners.forEach(fn => fn(this.moodSettings));
  }

  private restoreMood() {
    try {
      const saved = JSON.parse(localStorage.getItem(MOOD_KEY) ?? 'null') as { mood?: Mood; level?: number } | null;
      const mood = MOODS.find(m => m.id === saved?.mood)?.id ?? this.moodSettings.mood;
      const level = typeof saved?.level === 'number' ? clamp01(saved.level) : this.moodSettings.level;
      this.moodSettings = { ...this.moodSettings, mood, level };
    } catch {
      /* 使用預設值 */
    }
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
