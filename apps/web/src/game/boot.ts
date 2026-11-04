// 遊戲進入點：月台 ⇄ 車廂的旅程（docs/PRD.md 第 15 章）
// 連線時上下車、換座位、換車廂都經過伺服器；連不上時全部在本機模擬（離線模式）。
import { CARS, LINES, transferIndex, type LineId, type SpotId } from '@cc/shared';
import { mixer } from '../audio/AmbientMixer';
import { bridge } from '../gameBridge';
import type { NetLink } from '../net/session';
import { actions, devParams, store } from '../store';
import { CarriageScene } from './carriage';
import { DOORS, seatX } from './layout';
import { PlatformScene } from './platform';
import { Stage } from './stage';
import { loading } from '../ui/loading';

export async function boot(host: HTMLElement, net: NetLink | null) {
  const stage = new Stage();
  await stage.init(host);
  store.setState({ net: net ? 'online' : 'offline' });
  net?.onStatus(status => store.setState({ net: status }));
  // 轉乘後換線（docs/PRD.md §18.1）
  let lineId = store.getState().line;
  let line = LINES[lineId];

  const carriage = () => (stage.current?.kind === 'carriage' ? (stage.current as CarriageScene) : null);
  let busy = false;

  const startRide = (scene: CarriageScene) => {
    store.setState({
      ride: {
        line: lineId,
        boardedAt: Date.now(),
        fromIdx: scene.currentStation(),
        roomId: scene.trainId,
        coRiders: 0,
      },
      pomodorosDone: 0,
      received: { beep: 0, wave: 0, blanket: 0, fortune: 0 },
      lastFortune: null,
      yielded: { count: 0, to: null },
    });
  };

  // ── 月台 ──
  // 換場景時都有載入畫面蓋著，所以不另外交叉淡化
  const goPlatform = (station: number, docked?: { leftMs: number; toward: number; fromDoor: number; train?: string }, transition = false, via?: LineId) => {
    const here = lineId;
    const hooks = {
      board: (toward: number, train?: string) => board(station, toward, train),
      transfer: (to: LineId) => void transfer(station, to),
      // 連線時月台的列車跟伺服器同一班（docs/PRD.md 第 19 章）
      nextTrain: net ? () => net.nextArrival(here, station) : undefined,
    };
    stage.show(new PlatformScene({ lineId, station, docked, via }, hooks), transition);
    store.setState({ selfState: 'idle', pomodoro: null, ui: { ...store.getState().ui, glowMenu: null, noteMenu: null, composerOpen: false } });
  };

  // ── 轉乘：從連通道走到另一條線的月台，不用出站 ──
  // 月台上不在任何列車房間裡，所以換線只要記下新路線；下次上車時伺服器才分配那條線的列車
  const transfer = async (station: number, to: LineId) => {
    const idx = transferIndex(lineId, station, to);
    if (idx < 0 || busy) return;
    busy = true;
    try {
      const from = lineId;
      const target = LINES[to];
      mixer.playTransfer();
      await loading.during(`正在穿過連通道，前往${target.zh}月台…`, Promise.resolve(), {
        tip: `TPRT 提示：轉乘不用出站，跟著${target.zh}的 ${target.id} 路線色指標走就到了。`,
        lineColor: target.color,
        minMs: 2400,
      });
      lineId = to;
      line = target;
      store.setState({ line: to, station: idx });
      goPlatform(idx, undefined, false, from);
      actions.say(`這裡是${target.stations[idx].zh}，${target.zh}月台。｜${target.stations[idx].en}, ${target.en} platform.`);
    } finally {
      busy = false;
    }
  };

  // ── 上車 ──
  const board = async (station: number, toward: number, train?: string): Promise<boolean> => {
    const s = store.getState();
    const snapshot = net
      ? await loading.during(
        '列車即將出發',
        net.board({ line: lineId, name: s.name, gender: s.gender, avatar: s.avatar, passCard: s.passCard, ...(train ? { station, train } : {}) }),
        { lineColor: line.color },
      )
      : await loading.during('列車即將出發', Promise.resolve(null), { lineColor: line.color });
    if (net && !snapshot) return false;
    const scene = net && snapshot
      ? new CarriageScene({ kind: 'online', net, snapshot }, carriageHooks)
      : new CarriageScene({ kind: 'offline', station, toward, car: 1 + Math.floor(Math.random() * CARS) }, carriageHooks);
    stage.show(scene, false);
    startRide(scene);
    const st = store.getState();
    const terminal = line.stations[scene.train.dir === 1 ? line.stations.length - 1 : 0];
    actions.say(`往${terminal.zh}的列車。點空位換座位，點走道站著，兩端的通道可以走到隔壁車廂。｜Train to ${terminal.en}.`);
    actions.toast(`你坐進了第 ${st.car} 節車廂${st.selfSeat ? `，${st.selfSeat}` : ''}。`);
    return true;
  };

  const carriageHooks = {
    async alight() {
      const scene = carriage();
      if (!scene || busy) return;
      busy = true;
      try {
        const train = scene.train;
        const station = train.to;
        const ok = await loading.during(
          `正在走到${line.stations[station].zh}月台`,
          net ? net.alight() : Promise.resolve(true),
          { lineColor: line.color, minMs: 800 },
        );
        if (!ok) {
          actions.toast('車門要關了，下一站再下車吧。');
          return;
        }
        const n = line.stations.length;
        // 這班車繼續往同一個方向開；終點站則折返
        const dir = train.dir;
        const nextDir = station + dir < 0 || station + dir >= n ? -dir : dir;
        const toward = nextDir === 1 ? n - 1 : 0;
        const x = seatX(scene.selfSeat) + 32;
        const fromDoor = Math.abs(x - (DOORS[0].x + DOORS[0].w / 2)) < Math.abs(x - (DOORS[1].x + DOORS[1].w / 2)) ? 0 : 1;
        store.setState(st => (st.ride ? { ride: { ...st.ride, toIdx: station, endedAt: Date.now(), seat: scene.selfSeat } } : {}));
        goPlatform(station, { leftMs: train.dwellLeft(Date.now()), toward, fromDoor, train: net ? scene.trainId : undefined });
        actions.say(`${line.stations[station].zh}到了，路上小心。｜Welcome to ${line.stations[station].en}.`);
      } finally {
        busy = false;
      }
    },
    async moveCar(dir: -1 | 1) {
      const scene = carriage();
      if (!scene || busy) return;
      busy = true;
      try {
        const target = scene.car + dir;
        // 穿過貫通道：風聲＋載入畫面，回來時畫面往前進的方向滑動
        mixer.playGangway();
        const snap = await loading.during(
          `正在切換至第 ${target} 車廂`,
          net ? net.moveCar(dir) : Promise.resolve(null),
          { tip: dir === 1 ? `穿過通道門，往第 ${target} 車廂走去…` : `穿過通道門，往回走到第 ${target} 車廂…`, lineColor: line.color, minMs: 700 },
        );
        if (net && !snap) return actions.toast('隔壁車廂人太多了，先待在這裡吧。');
        stage.slide(dir);
        if (snap) scene.applySnapshot(snap, false);
        else scene.moveCarLocal(target);
        actions.toast(`走到了第 ${store.getState().car} 節車廂。`);
      } finally {
        busy = false;
      }
    },
    async moveSeat(seat: SpotId) {
      const scene = carriage();
      if (!scene || busy) return;
      busy = true;
      try {
        if (net && !(await net.moveSeat(seat))) return actions.toast('那個位子剛好有人了。');
        scene.moveSelf(seat);
      } finally {
        busy = false;
      }
    },
  };

  // 補眠時降幀省電
  store.subscribe((s, prev) => {
    if (s.selfState !== prev.selfState) stage.maxFPS = s.selfState === 'sleep' && s.scene === 'carriage' ? 30 : 0;
  });

  bridge.game = {
    async writeNote(text) {
      return carriage()?.writeNote(text) ?? { ok: false, code: 'NETWORK' };
    },
    async glow(seat, kind) {
      await carriage()?.glow(seat, kind);
    },
    wipeNote: window => carriage()?.wipeNote(window),
    reportNote: async window => carriage()?.reportNote(window),
    currentStation: () => carriage()?.currentStation() ?? store.getState().platform.station,
    alight: () => void carriageHooks.alight(),
    moveCar: dir => void carriageHooks.moveCar(dir),
    async signTicket(stats) {
      if (!net) return null;
      try {
        const res = await fetch('/api/ticket', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(stats),
        });
        if (!res.ok) return null;
        const { token } = (await res.json()) as { token: string };
        return `${location.origin}/t/${token}`;
      } catch {
        return null;
      }
    },
  };

  if (devParams.dev) {
    Object.assign(window, { __stage: stage, __scene: () => (stage.current as unknown as { debug(): unknown })?.debug() });
  }

  // 從閘門走進選好的那一站月台
  goPlatform(store.getState().station ?? 0, undefined, false);
}
