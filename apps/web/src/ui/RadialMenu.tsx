// 點其他乘客時展開的環形輪盤（docs/PRD.md §18.2、§23.2）：等分的扇形、只有像素圖示、中心是關閉鈕
// 畫面上不放說明文字；名稱只留給螢幕閱讀器（aria-label）。車廂五個互動、月台四個。
import { useEffect, useRef, useState } from 'react';
import type { GlowKind, PaxState } from '@cc/shared';
import { mixer } from '../audio/AmbientMixer';
import { bridge, type PlatformGlow } from '../gameBridge';
import { actions, useApp } from '../store';

/** 12×12 單色像素圖示：# 是一格 */
const ICONS: Record<GlowKind | PlatformGlow | 'close', string[]> = {
  hi: [
    '....#.#.....',
    '...#.#.#.#..',
    '...#.#.#.#..',
    '#..#.#.#.#..',
    '.#.#######..',
    '...#######.#',
    '..#########.',
    '..########..',
    '...######...',
    '....####....',
    '#...........',
    '.#..........',
  ],
  beep: [
    '............',
    '............',
    '.##########.',
    '#..........#',
    '#.###......#',
    '#.###.####.#',
    '#..........#',
    '#.....###..#',
    '#..........#',
    '.##########.',
    '............',
    '............',
  ],
  wave: [
    '....#######.',
    '....#######.',
    '....#.....#.',
    '....#.....#.',
    '....#.....#.',
    '....#.....#.',
    '..###...###.',
    '.####..####.',
    '.####..####.',
    '..##....##..',
    '............',
    '#.#.#.#.#.#.',
  ],
  blanket: [
    '........###.',
    '..........#.',
    '.........#..',
    '........###.',
    '............',
    '############',
    '#.#.#.#.#.##',
    '############',
    '#..........#',
    '#..........#',
    '############',
    '............',
  ],
  fortune: [
    '.##########.',
    '#..........#',
    '.##########.',
    '..#......#..',
    '..#.####.#..',
    '..#......#..',
    '..#.###..#..',
    '..#......#..',
    '..#.####.#..',
    '.##########.',
    '#..........#',
    '.##########.',
  ],
  close: [
    '............',
    '............',
    '..##....##..',
    '...##..##...',
    '....####....',
    '.....##.....',
    '....####....',
    '...##..##...',
    '..##....##..',
    '............',
    '............',
    '............',
  ],
};

interface Slice { kind: GlowKind | PlatformGlow; label: (st: PaxState) => string; enabled?: (st: PaxState) => boolean }

/** 車廂：依對方此刻的狀態，蓋小毯只能給正在補眠的人（docs/PRD.md 第 17 章）；打招呼在正上方 */
const CAR_SLICES: Slice[] = [
  { kind: 'hi', label: () => '打招呼：揮揮手說聲 Hi' },
  { kind: 'beep', label: () => '嗶卡默契：刷一下隨行卡打招呼' },
  { kind: 'wave', label: st => (st === 'music' ? '同頻波紋：一起跟著音樂跳動' : '同頻波紋：送上一點溫暖微光') },
  { kind: 'blanket', label: st => (st === 'sleep' ? '蓋上小毯' : '蓋上小毯（對方補眠時才能蓋）'), enabled: st => st === 'sleep' },
  { kind: 'fortune', label: () => '遞幸運籤：送一張今日小吉籤' },
];

/** 月台（§23.2）：上 打招呼、右 嗶卡、下 同頻波紋、左 幸運籤；月台是候車空間，沒有蓋小毯 */
const PLATFORM_SLICES: Slice[] = [
  { kind: 'hi', label: () => '打招呼：揮揮手說聲 Hi' },
  { kind: 'beep', label: () => '嗶卡默契：刷一下隨行卡打招呼' },
  { kind: 'wave', label: () => '同頻波紋：送上一點溫暖微光' },
  { kind: 'fortune', label: () => '遞幸運籤：送一張今日吉籤' },
];

const R = 88;
const R_IN = 30;
const GAP_DEG = 3;
/** 四等分時方向鍵直接對應扇形（上、右、下、左）；其他等分時左右鍵依序繞圈 */
const ARROWS: Record<string, number> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };

function PixelIcon({ rows, x, y, scale = 2 }: { rows: string[]; x: number; y: number; scale?: number }) {
  // 連續的格子併成一條，減少節點
  const rects: { x: number; y: number; w: number }[] = [];
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      if (row[rx] !== '#') continue;
      let w = 1;
      while (row[rx + w] === '#') w++;
      rects.push({ x: rx, y: ry, w });
      rx += w - 1;
    }
  });
  return (
    <g transform={`translate(${x - 6 * scale} ${y - 6 * scale}) scale(${scale})`} fill="currentColor" shapeRendering="crispEdges">
      {rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} />)}
    </g>
  );
}

/** n 等分中第 i 個扇形（0 在正上方，順時針）的路徑 */
function slicePath(i: number, n: number) {
  const step = 360 / n;
  const a0 = ((-90 - step / 2 + GAP_DEG / 2 + i * step) * Math.PI) / 180;
  const a1 = ((-90 + step / 2 - GAP_DEG / 2 + i * step) * Math.PI) / 180;
  const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(R, a0)} A ${R} ${R} 0 0 1 ${p(R, a1)} L ${p(R_IN + 2, a1)} A ${R_IN + 2} ${R_IN + 2} 0 0 0 ${p(R_IN + 2, a0)} Z`;
}

function sliceCenter(i: number, n: number) {
  const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
  const r = (R + R_IN) / 2 + 1;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

export function RadialMenu() {
  const menu = useApp(s => s.ui.glowMenu);
  const night = useApp(s => s.mode === 'night');
  const [hot, setHot] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<(SVGGElement | null)[]>([]);

  // 每次開在新的人身上都重新開始
  useEffect(() => {
    setHot(null);
    setLeaving(false);
    root.current?.focus({ preventScroll: true });
  }, [menu?.target, menu?.x, menu?.y]);

  if (!menu) return null;
  const { target } = menu;
  const SLICES = typeof target === 'string' ? CAR_SLICES : PLATFORM_SLICES;
  const close = () => actions.setUi({ glowMenu: null });
  const enabled = (i: number) => SLICES[i].enabled?.(menu.state) ?? true;

  const highlight = (i: number | null) => {
    if (i === hot) return;
    setHot(i);
    if (i !== null && enabled(i)) mixer.playTick();
  };

  const pick = (i: number) => {
    if (!enabled(i) || leaving) return;
    setLeaving(true);
    // 輪盤向外擴散淡出，同時把互動送出去
    const kind = SLICES[i].kind;
    if (typeof target === 'string') void bridge.game?.glow(target, kind as GlowKind);
    else bridge.game?.platformGlow(target.npc, kind as PlatformGlow);
    setTimeout(close, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return close();
    if (e.key in ARROWS) {
      e.preventDefault();
      const n = SLICES.length;
      const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      const i = n === 4 ? ARROWS[e.key] : hot === null ? 0 : (hot + (back ? n - 1 : 1)) % n;
      items.current[i]?.focus();
      highlight(i);
    }
  };

  // 輪盤整個留在畫面內
  const size = R * 2 + 8;
  const cx = Math.max(size / 2 + 4, Math.min(menu.x, window.innerWidth - size / 2 - 4));
  const cy = Math.max(size / 2 + 4, Math.min(menu.y, window.innerHeight - size / 2 - 4));

  return (
    <div className="pointer-events-auto fixed inset-0" onPointerDown={e => e.target === e.currentTarget && close()}>
      <div
        ref={root}
        role="menu"
        tabIndex={-1}
        aria-label={`和 ${menu.name} 互動（對方不會知道是誰）`}
        onKeyDown={onKey}
        className={`radial ${leaving ? 'radial--out' : ''} ${night ? 'radial--night' : 'radial--day'} absolute outline-none`}
        style={{ left: cx - size / 2, top: cy - size / 2, width: size, height: size }}
      >
        <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} width={size} height={size} onPointerLeave={() => highlight(null)}>
          {SLICES.map((s, i) => {
            const c = sliceCenter(i, SLICES.length);
            const on = enabled(i);
            return (
              <g
                key={s.kind}
                ref={el => void (items.current[i] = el)}
                role="menuitem"
                tabIndex={on ? 0 : -1}
                aria-label={s.label(menu.state)}
                aria-disabled={!on}
                className={`radial__slice ${hot === i ? 'radial__slice--hot' : ''} ${on ? '' : 'radial__slice--off'}`}
                onPointerEnter={() => highlight(i)}
                onFocus={() => highlight(i)}
                onClick={() => pick(i)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(i))}
              >
                <path d={slicePath(i, SLICES.length)} />
                <PixelIcon rows={ICONS[s.kind]} x={c.x} y={c.y} />
              </g>
            );
          })}
          <g role="menuitem" tabIndex={0} aria-label="關閉" className="radial__close" onClick={close} onKeyDown={e => e.key === 'Enter' && close()}>
            <circle r={R_IN - 2} />
            <PixelIcon rows={ICONS.close} x={0} y={1} />
          </g>
        </svg>
      </div>
    </div>
  );
}
