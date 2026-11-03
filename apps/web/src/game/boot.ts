// 遊戲進入點：月台 ⇄ 車廂的旅程（docs/PRD.md 第 15 章）
// 連線時上下車、換座位、換車廂都經過伺服器；連不上時全部在本機模擬（離線模式）。
import { CARS, LINES, type SpotId } from '@cc/shared';
import { bridge } from '../gameBridge';
import type { NetLink } from '../net/session';
import { actions, devParams, store } from '../store';
import { CarriageScene } from './carriage';
import { DOORS, seatX } from './layout';
import { PlatformScene } from './platform';
import { Stage } from './stage';

export async function boot(host: HTMLElement, net: NetLink | null) {
  const stage = new Stage();
  await stage.init(host);
  store.setState({ net: net ? 'online' : 'offline' });
  net?.onStatus(status => store.setState({ net: status }));
  const lineId = store.getState().line;
  const line = LINES[lineId];

  const carriage = () => (stage.current?.kind === 'carriage' ? (stage.current as CarriageScene) : null);
  let busy = false;

  const startRide = (scene: CarriageScene) => {
    store.setState({
      ride: {
        boardedAt: Date.now(),
        fromIdx: scene.currentStation(),
        roomId: scene.trainId,
        coRiders: 0,
      },
      pomodorosDone: 0,
      cheersReceived: 0,
    });
  };

  // ── 月台 ──
  const goPlatform = (station: number, docked?: { leftMs: number; toward: number; fromDoor: number }) => {
    stage.show(new PlatformScene({ lineId, station, docked }, { board: toward => board(station, toward) }), true);
    store.setState({ selfState: 'idle', pomodoro: null, ui: { ...store.getState().ui, glowMenu: null, noteMenu: null, composerOpen: false } });
  };

  // ── 上車 ──
  const board = async (station: number, toward: number): Promise<boolean> => {
    const s = store.getState();
    let scene: CarriageScene;
    if (net) {
      const snapshot = await net.board({ line: lineId, name: s.name, gender: s.gender, avatar: s.avatar, passCard: s.passCard });
      if (!snapshot) return false;
      scene = new CarriageScene({ kind: 'online', net, snapshot }, carriageHooks);
    } else {
      scene = new CarriageScene({ kind: 'offline', station, toward, car: 1 + Math.floor(Math.random() * CARS) }, carriageHooks);
    }
    stage.show(scene, true);
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
        if (net && !(await net.alight())) {
          actions.toast('車門要關了，下一站再下車吧。');
          return;
        }
        const train = scene.train;
        const station = train.to;
        const n = line.stations.length;
        // 這班車繼續往同一個方向開；終點站則折返
        const dir = train.dir;
        const nextDir = station + dir < 0 || station + dir >= n ? -dir : dir;
        const toward = nextDir === 1 ? n - 1 : 0;
        const x = seatX(scene.selfSeat) + 32;
        const fromDoor = Math.abs(x - (DOORS[0].x + DOORS[0].w / 2)) < Math.abs(x - (DOORS[1].x + DOORS[1].w / 2)) ? 0 : 1;
        store.setState(st => (st.ride ? { ride: { ...st.ride, toIdx: station, endedAt: Date.now(), seat: scene.selfSeat } } : {}));
        goPlatform(station, { leftMs: train.dwellLeft(Date.now()), toward, fromDoor });
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
        if (net) {
          const snap = await net.moveCar(dir);
          if (!snap) return actions.toast('隔壁車廂人太多了，先待在這裡吧。');
          stage.crossfade(0.7);
          scene.applySnapshot(snap, false);
        } else {
          stage.crossfade(0.7);
          scene.moveCarLocal(scene.car + dir);
        }
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
    Object.assign(window, { __scene: () => (stage.current as unknown as { debug(): unknown })?.debug() });
  }

  // 從閘門走進月台：隨機一站（地下、高架都有機會）；開發時可用 ?station= 指定
  const preset = Number(new URLSearchParams(location.search).get('station'));
  const station = preset >= 1 && preset <= line.stations.length ? preset - 1 : Math.floor(Math.random() * line.stations.length);
  goPlatform(station);
}
