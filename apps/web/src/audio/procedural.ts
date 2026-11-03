// M0 占位環境音：以程式合成，零授權風險。正式版換成 CC0 錄音與委託原創曲（docs/PRD.md §3.6）
// 所有循環都在結尾與開頭做交叉淡化，確保 AudioBufferSourceNode 循環時沒有接縫。

const white = () => Math.random() * 2 - 1;

/** 把多算的尾段淡入開頭，讓 [0, len) 可無縫循環 */
function loopify(data: Float32Array, len: number, fade: number) {
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    data[i] = data[i] * k + data[len + i] * (1 - k);
  }
}

function normalize(channels: Float32Array[], peak: number) {
  let max = 0;
  for (const ch of channels) for (const v of ch) max = Math.max(max, Math.abs(v));
  const g = max > 0 ? peak / max : 1;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

/** 鐵軌行駛底音：低頻隆隆聲＋馬達聲＋每秒一組「喀噹、喀噹」 */
export function synthRail(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = sr * 8;
  const fade = sr;
  const buffer = ctx.createBuffer(2, len, sr);
  const channels: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const tmp = new Float32Array(len + fade);
    let brown = 0;
    let lp = 0;
    for (let i = 0; i < tmp.length; i++) {
      brown = (brown + 0.02 * white()) / 1.02;
      lp += 0.05 * (white() - lp);
      tmp[i] = brown * 3.2 + lp * 0.12;
    }
    loopify(tmp, len, fade);
    const out = tmp.subarray(0, len);
    // 週期性成分：整數個週期剛好填滿 8 秒，循環天然連續
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      out[i] += 0.025 * Math.sin(2 * Math.PI * 110 * t) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t));
      out[i] += 0.012 * Math.sin(2 * Math.PI * 220 * t);
    }
    for (let beat = 0; beat < 8; beat++) {
      for (const offset of [0, 0.13]) {
        const start = Math.floor((beat + 0.2 + offset + c * 0.004) * sr);
        let n = 0;
        for (let j = 0; j < sr * 0.12 && start + j < len; j++) {
          const env = Math.exp(-j / (sr * 0.018));
          n += 0.3 * (white() - n);
          out[start + j] += env * (0.35 * n + 0.5 * Math.sin(2 * Math.PI * 58 * (j / sr)));
        }
      }
    }
    channels.push(out);
  }
  normalize(channels, 0.8);
  channels.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  return buffer;
}

/** 車窗雨聲：濾過的白噪音＋隨機落在玻璃上的水滴聲 */
export function synthRain(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = sr * 6;
  const fade = Math.floor(sr * 0.5);
  const buffer = ctx.createBuffer(2, len, sr);
  const channels: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const tmp = new Float32Array(len + fade);
    let low = 0;
    let hiCut = 0;
    for (let i = 0; i < tmp.length; i++) {
      const w = white();
      low += 0.02 * (w - low);
      hiCut += 0.45 * (w - low - hiCut);
      tmp[i] = hiCut * 0.25;
    }
    // 水滴：短促的高頻正弦，偶爾一顆較大的
    for (let k = 0; k < 6 * 28; k++) {
      const start = Math.floor(Math.random() * len);
      const big = Math.random() < 0.08;
      const f = big ? 900 + Math.random() * 900 : 2200 + Math.random() * 3800;
      const decay = sr * (big ? 0.02 : 0.004);
      const amp = big ? 0.35 : 0.05 + Math.random() * 0.15;
      for (let j = 0; j < decay * 5 && start + j < tmp.length; j++) {
        tmp[start + j] += amp * Math.exp(-j / decay) * Math.sin(2 * Math.PI * f * (j / sr));
      }
    }
    loopify(tmp, len, fade);
    channels.push(tmp.slice(0, len));
  }
  normalize(channels, 0.7);
  channels.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  return buffer;
}

const NOTE = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Lo-Fi 鋼琴：Fmaj7 → Em7 → Dm7 → Cmaj7，16 秒一輪 */
export async function synthLofi(sampleRate: number): Promise<AudioBuffer> {
  const seconds = 16;
  const ctx = new OfflineAudioContext(2, sampleRate * seconds, sampleRate);
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1800 });
  const master = new GainNode(ctx, { gain: 0.5 });
  tone.connect(master).connect(ctx.destination);

  const chords = [
    [53, 57, 60, 64], // Fmaj7
    [52, 55, 59, 62], // Em7
    [50, 53, 57, 60], // Dm7
    [48, 52, 55, 59], // Cmaj7
  ];
  const melody = [[72, 69], [71, 67], [69, 65], [67, 64]];

  const strike = (midi: number, at: number, dur: number, vel: number, pan: number) => {
    const out = new GainNode(ctx, { gain: 0 });
    const panner = new StereoPannerNode(ctx, { pan });
    out.connect(panner).connect(tone);
    for (const [mult, amp] of [[1, 1], [2, 0.3], [3, 0.08]] as const) {
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: NOTE(midi) * mult, detune: (Math.random() - 0.5) * 6 });
      const g = new GainNode(ctx, { gain: amp });
      osc.connect(g).connect(out);
      osc.start(at);
      osc.stop(at + dur);
    }
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(vel, at + 0.012);
    out.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  };

  chords.forEach((chord, b) => {
    const t0 = b * 4;
    chord.forEach((m, i) => strike(m, t0 + i * 0.025, 3.8, 0.16, (i - 1.5) * 0.2));
    melody[b].forEach((m, i) => strike(m, t0 + 1.5 + i * 1.25, 1.6, 0.09, 0.15));
  });

  // 唱盤的細碎底噪
  const crackle = ctx.createBuffer(1, sampleRate * seconds, sampleRate);
  const data = crackle.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() < 0.0004 ? white() * 0.25 : white() * 0.004;
  const src = new AudioBufferSourceNode(ctx, { buffer: crackle });
  src.connect(master);
  src.start();

  return ctx.startRendering();
}
