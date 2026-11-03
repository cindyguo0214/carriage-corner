// 車廂場景進入點：像素完美渲染管線 → 640×360（直式隨螢幕寬度）RenderTexture → 整數倍放大（docs/PRD.md §6.4）
// 連線時由伺服器驅動乘客、列車與留言；連不上時改用本機模擬（離線模式）。
import {
  Application, Container, Graphics, RenderTexture, Sprite, TextureStyle, type Texture,
} from 'pixi.js';
import type { BoardedSnapshot, Mode, SeatId, WindowNote } from '@cc/shared';
import { mixer } from '../audio/AmbientMixer';
import { bridge, type NoteResult } from '../gameBridge';
import type { NetSession } from '../net/session';
import { actions, devParams, store } from '../store';
import { buildCharacterAtlas } from './characters';
import { WindowGlass } from './glass';
import { buildInterior } from './interior';
import {
  B_PANEL_Y, DOORS, H, MIN_PW, PH, PORTRAIT_WORLD_Y, PW, SEAT_W, STRAP_XS, STRAP_Y, W,
  seatX, windowForSeat, windowRect,
} from './layout';
import { Lighting } from './lighting';
import { hexToNum, PALETTES } from './palette';
import { Particles } from './particles';
import { Passengers, type Pax } from './passengers';
import { Scenery } from './scenery';
import { buildScenery } from './sceneryArt';
import { legFromSnapshot, Train } from './train';

TextureStyle.defaultOptions.scaleMode = 'nearest';

const GLASS_INTERVAL = 1 / 20;
const LOCAL_SELF = 'self';

export async function boot(host: HTMLElement, session: NetSession | null) {
  const app = new Application();
  await app.init({
    resizeTo: host,
    preference: 'webgl',
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    roundPixels: true,
    background: '#3A3846',
  });
  host.appendChild(app.canvas);

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const lineId = session?.snapshot.room.line ?? store.getState().line;
  store.setState({ line: lineId, net: session ? 'online' : 'offline' });

  // ── 場景圖層（由後到前）──
  const world = new Container();
  const scenery = new Scenery();
  const glassLayer = new Container();
  const glasses = Array.from({ length: 6 }, (_, i) => new WindowGlass(i));
  glasses.forEach(g => glassLayer.addChild(g.sprite));
  const interiorBack = new Sprite();
  const led = new Graphics();
  const strapLayer = new Container();
  const straps = STRAP_XS.map(x => {
    const s = new Sprite();
    s.position.set(x - 4, STRAP_Y + 2);
    strapLayer.addChild(s);
    return s;
  });
  const particles = new Particles();
  const passengers = new Passengers(particles, {
    steam: () => hexToNum(PALETTES[store.getState().mode].glow),
    zzz: () => hexToNum(PALETTES[store.getState().mode].ledOn),
  }, !session);
  const interiorFront = new Sprite();
  interiorFront.y = B_PANEL_Y;
  const lighting = new Lighting();
  world.addChild(
    scenery.view, glassLayer, interiorBack, led, strapLayer,
    passengers.backRow, passengers.frontRow, interiorFront, lighting.view, particles.view,
  );

  // ── 列車 ──
  const train = new Train(lineId, {
    announce(next) {
      const s = train.line.stations[next];
      actions.say(`我們快到${s.zh}了。下車的朋友，慢慢來。｜Almost at ${s.en}. Take your time.`);
    },
    arrive() {
      store.setState({ train: { from: train.from, to: train.to, phase: 'dwell' } });
      if (!session) passengers.shuffleLocalAtStation();
    },
    doorChime() {
      mixer.playDoorChime();
      actions.say('列車要出發了，想再坐一會兒也沒關係。');
    },
    depart(from, to) {
      store.setState({ train: { from, to, phase: 'run' } });
      scenery.onDepart(train);
    },
  }, session ? null : { runSec: devParams.runSec });

  // ── 乘客與留言 ──
  let selfPid = LOCAL_SELF;
  let selfSeat: SeatId = '3B';
  /** 每扇窗目前的留言；mine 用來決定點窗時是「寫字」還是「擦掉／檢舉」 */
  const windowNotes = new Map<number, { nid: string; mine: boolean }>();
  const myNids = new Set<string>();
  const offset = () => session?.offset ?? 0;
  /** 同車過的真人乘客（車票上的「和 N 位陌生人同行」） */
  const riders = new Set<string>();
  const noteRider = (p: { pid: string; npc?: boolean }) => {
    if (p.npc || p.pid === selfPid || riders.has(p.pid)) return;
    riders.add(p.pid);
    store.setState(s => (s.ride ? { ride: { ...s.ride, coRiders: riders.size } } : {}));
  };

  const applyNote = (n: WindowNote) => {
    glasses[n.window].writeNote(n.text, n.expiresAt - n.createdAt, n.createdAt - offset());
    windowNotes.set(n.window, { nid: n.nid, mine: myNids.has(n.nid) });
  };

  const applySnapshot = (snap: BoardedSnapshot, isResync: boolean) => {
    passengers.clear();
    snap.passengers.forEach(p => passengers.add(p, false));
    selfPid = snap.you.pid;
    selfSeat = snap.you.seat;
    const self = passengers.get(selfPid);
    store.setState({ selfPid, selfSeat, ...(self ? { selfState: self.state } : {}) });
    glasses.forEach(g => g.clearNote());
    windowNotes.clear();
    snap.notes.forEach(applyNote);
    train.setLeg(legFromSnapshot(train.line, snap.train, offset()), Date.now(), false);
    store.setState({ train: { from: train.from, to: train.to, phase: train.phase } });
    snap.passengers.forEach(noteRider);
    if (isResync) scenery.onDepart(train);
  };

  if (session) {
    applySnapshot(session.snapshot, false);
  } else {
    train.startLocal(Date.now(), devParams.dwellSec * 1000);
    for (let i = 0; i < 4 + Math.floor(Math.random() * 2); i++) passengers.boardLocalNpc();
    selfSeat = passengers.freeSeat() ?? '3B';
    const { avatar, selfState } = store.getState();
    passengers.add({ pid: LOCAL_SELF, seat: selfSeat, avatar, state: selfState, since: Date.now() });
    store.setState({ selfPid, selfSeat, train: { from: train.from, to: train.to, phase: train.phase } });
    // 示範用：已經有人在窗上寫過一句話
    const demo = [0, 1, 2, 3, 4, 5].find(i => i !== windowForSeat(selfSeat)) ?? 0;
    applyNote({ nid: 'demo', window: demo, text: '今天也要好好吃飯', mode: 'night', createdAt: Date.now() - 30_000, expiresAt: Date.now() + devParams.noteTtlSec * 1000 });
  }

  // 這趟旅程從此刻、從這一站開始（重連時沿用同一趟）
  const currentStation = () => (train.phase === 'dwell' ? train.to : train.from);
  store.setState({
    ride: {
      boardedAt: Date.now(),
      fromIdx: currentStation(),
      roomId: session?.snapshot.room.id ?? `${lineId}-0000`,
      coRiders: riders.size,
    },
  });

  // ── 美術（依晨／夜模式建置，切換時重建並交叉淡化）──
  let currentArt: Texture[] = [];
  let strapArt: Texture[] = [];
  const applyMode = (mode: Mode) => {
    const pal = PALETTES[mode];
    const interior = buildInterior(pal, train.line.seatColor);
    const sceneryArt = buildScenery(pal, mode === 'night', train.line.color);
    const chars = buildCharacterAtlas(mode);
    interiorBack.texture = interior.back;
    interiorFront.texture = interior.front;
    strapArt = interior.straps;
    scenery.setArt(sceneryArt, train);
    glasses.forEach(g => g.setPalette(pal, mode === 'night'));
    lighting.setPalette(pal, mode);
    passengers.setFrames(chars);
    app.renderer.background.color = mode === 'night' ? '#2E2C38' : '#D6CDBE';
    const old = currentArt;
    currentArt = [
      interior.back, interior.front, ...interior.straps,
      sceneryArt.sky, sceneryArt.far, sceneryArt.tunnel, sceneryArt.platformOpen, sceneryArt.platformUnder,
      ...Object.values(sceneryArt.mid), ...Object.values(sceneryArt.near), ...sceneryArt.rain,
      chars.office.front[0], // 所有角色 frame 共用同一個 atlas source，釋放一次即可
    ];
    // 下一幀才釋放舊貼圖，避免本幀仍在使用
    requestAnimationFrame(() => old.forEach(t => t.destroy(true)));
  };
  applyMode(store.getState().mode);

  // ── 渲染管線：world → worldRT（640×360）；直式再組成 screenRT ──
  const worldRT = RenderTexture.create({ width: W, height: H });
  const screenRT = RenderTexture.create({ width: PW, height: PH });
  const screen = new Container();
  const screenBg = new Graphics();
  const worldInScreen = new Sprite(worldRT);
  worldInScreen.y = PORTRAIT_WORLD_Y;
  screen.addChild(screenBg, worldInScreen);
  const display = new Sprite(worldRT);
  const fade = new Sprite();
  fade.visible = false;
  app.stage.addChild(display, fade);

  let portrait = false;
  let camX = 0;
  let cssScale = 1;
  /** 直式畫布寬度：隨螢幕調整，窄螢幕不裁切、寬一點的手機多看到幾個座位 */
  let screenW = PW;
  const clampCam = (x: number) => Math.max(0, Math.min(W - screenW, Math.round(x)));
  const centerCamOnSelf = () => (camX = clampCam(seatX(selfSeat) + SEAT_W / 2 - screenW / 2));

  const layout = () => {
    const cssW = app.screen.width;
    const cssH = app.screen.height;
    const dpr = app.renderer.resolution;
    portrait = cssH > cssW * 1.05;
    // 以實體像素計算最大整數倍率
    let scale: number;
    if (portrait) {
      scale = Math.max(1, Math.floor(Math.min((cssW * dpr) / MIN_PW, (cssH * dpr) / PH)));
      const width = Math.min(W, Math.floor((cssW * dpr) / scale));
      if (width !== screenW) {
        screenW = width;
        screenRT.resize(screenW, PH);
        drawScreenBg();
      }
    } else {
      scale = Math.max(1, Math.floor(Math.min((cssW * dpr) / W, (cssH * dpr) / H)));
    }
    const bw = portrait ? screenW : W;
    const bh = portrait ? PH : H;
    cssScale = scale / dpr;
    display.texture = portrait ? screenRT : worldRT;
    display.scale.set(cssScale);
    display.position.set(
      Math.round((cssW * dpr - bw * scale) / 2) / dpr,
      Math.round((cssH * dpr - bh * scale) / 2) / dpr,
    );
    fade.scale.copyFrom(display.scale);
    fade.position.copyFrom(display.position);
    if (portrait) centerCamOnSelf();
  };
  function drawScreenBg() {
    const pal = PALETTES[store.getState().mode];
    screenBg.clear();
    screenBg.rect(0, 0, screenW, PORTRAIT_WORLD_Y).fill(hexToNum(pal.ceiling));
    screenBg.rect(0, PORTRAIT_WORLD_Y - 6, screenW, 4).fill(hexToNum(pal.ceilingLight));
    screenBg.rect(0, PORTRAIT_WORLD_Y + H, screenW, PH - PORTRAIT_WORLD_Y - H).fill(hexToNum(pal.floor));
  }
  drawScreenBg();
  app.renderer.on('resize', layout);
  layout();

  // 晨／夜切換：把目前畫面拍成快照，蓋在上面 1.2 秒淡出
  let fadeT = 0;
  store.subscribe((s, prev) => {
    if (s.mode === prev.mode) return;
    const snap = RenderTexture.create({ width: portrait ? screenW : W, height: portrait ? PH : H });
    const tmp = new Sprite(display.texture);
    app.renderer.render({ container: tmp, target: snap });
    tmp.destroy();
    if (fade.texture && fade.visible) fade.texture.destroy(true);
    fade.texture = snap;
    fade.visible = true;
    fadeT = 1;
    applyMode(s.mode);
    drawScreenBg();
  });

  // ── 自己的狀態與偏好：本機立即反映，再（去抖動後）同步給同車乘客 ──
  let stateTimer: ReturnType<typeof setTimeout> | undefined;
  store.subscribe((s, prev) => {
    if (s.selfState !== prev.selfState) {
      passengers.setState(selfPid, s.selfState);
      app.ticker.maxFPS = s.selfState === 'sleep' ? 30 : 0; // 補眠時降幀省電
      if (session) {
        clearTimeout(stateTimer);
        stateTimer = setTimeout(() => void session.socket.timeout(4000).emitWithAck('state:set', { state: store.getState().selfState }).catch(() => {}), 600);
      }
    }
    if (session && s.dnd !== prev.dnd) {
      void session.socket.timeout(4000).emitWithAck('pref:set', { dnd: s.dnd }).catch(() => {});
    }
  });

  // ── 微光 ──
  const showGlow = (target: Pax) => {
    const cx = target.sprite.x + 32;
    const cy = target.sprite.y + 14;
    lighting.addGlow(cx, cy);
    const tint = hexToNum(PALETTES[store.getState().mode].glow);
    for (let i = 0; i < 6; i++) particles.emit('spark', cx - 8 + Math.random() * 16, cy - 4, tint);
  };

  // ── 伺服器事件 ──
  if (session) {
    const { socket } = session;
    socket.on('pax:join', p => {
      passengers.add(p);
      noteRider(p);
    });
    socket.on('pax:leave', ({ pid }) => passengers.remove(pid));
    socket.on('pax:state', ({ pid, state }) => {
      if (pid !== selfPid) passengers.setState(pid, state);
    });
    socket.on('glow', ({ to, kind }) => {
      const target = passengers.get(to);
      if (target) showGlow(target);
      if (to === selfPid) {
        store.setState(s => (kind === 'coffee' ? { coffeeReceived: s.coffeeReceived + 1 } : { cheersReceived: s.cheersReceived + 1 }));
        actions.toast(kind === 'coffee' ? '有人遞了一杯熱咖啡給你。' : '有人對你點了點頭。');
      }
    });
    socket.on('note:new', applyNote);
    socket.on('note:gone', ({ nid }) => {
      for (const [w, n] of windowNotes) {
        if (n.nid !== nid) continue;
        glasses[w].clearNote();
        windowNotes.delete(w);
      }
    });
    socket.on('train:arrive', e => {
      e.leaving.forEach(pid => passengers.remove(pid));
      e.npc.leave.forEach(pid => passengers.remove(pid));
      e.npc.board.forEach(p => passengers.add(p));
    });
    socket.on('train:depart', ({ train: t }) => train.setLeg(legFromSnapshot(train.line, t, offset()), Date.now(), true));
    session.onResync(snap => applySnapshot(snap, true));
    session.onStatus(status => store.setState({ net: status }));
  }

  // ── 輸入：點車窗寫字（或處理別人的留言）、點乘客送微光；直式可左右拖曳座位列 ──
  let drag: { x: number; cam: number; moved: boolean } | null = null;
  const toWorld = (e: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const bx = (e.clientX - rect.left - display.x) / cssScale;
    const by = (e.clientY - rect.top - display.y) / cssScale;
    return portrait ? { x: bx + camX, y: by - PORTRAIT_WORLD_Y } : { x: bx, y: by };
  };
  app.canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, cam: camX, moved: false };
  });
  app.canvas.addEventListener('pointermove', e => {
    if (!drag || !portrait) return;
    const dx = (e.clientX - drag.x) / cssScale;
    if (Math.abs(dx) > 4) drag.moved = true;
    camX = clampCam(drag.cam - dx);
  });
  app.canvas.addEventListener('pointerup', e => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    const p = toWorld(e);
    const hit = passengers.all.find(
      x => x.pid !== selfPid && !x.leaving
        && p.x >= x.sprite.x + 14 && p.x < x.sprite.x + 50 && p.y >= x.sprite.y + 4 && p.y < x.sprite.y + 62,
    );
    if (hit) {
      actions.setUi({ glowMenu: { seat: hit.seat, x: e.clientX, y: e.clientY }, noteMenu: null });
      return;
    }
    const win = [0, 1, 2, 3, 4, 5].find(i => {
      const r = windowRect(i);
      return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
    });
    if (win !== undefined) {
      const note = windowNotes.get(win);
      if (note && !note.mine && glasses[win].hasNote) {
        actions.setUi({ noteMenu: { window: win, x: e.clientX, y: e.clientY }, glowMenu: null });
      } else {
        actions.setUi({ composerOpen: true, glowMenu: null, noteMenu: null });
      }
      return;
    }
    actions.setUi({ glowMenu: null, noteMenu: null });
  });

  const wipeNote = (window: number) => {
    glasses[window].clearNote();
    windowNotes.delete(window);
  };

  bridge.game = {
    async writeNote(text): Promise<NoteResult> {
      if (!session) {
        const now = Date.now();
        applyNote({ nid: `local_${now}`, window: windowForSeat(selfSeat), text, mode: store.getState().mode, createdAt: now, expiresAt: now + devParams.noteTtlSec * 1000 });
        windowNotes.get(windowForSeat(selfSeat))!.mine = true;
        return { ok: true };
      }
      try {
        const res = await session.socket.timeout(4000).emitWithAck('note:write', { text });
        if (!res.ok) return res;
        myNids.add(res.data.nid);
        // note:new 可能比 ack 先到：補標記為自己的留言
        for (const n of windowNotes.values()) if (n.nid === res.data.nid) n.mine = true;
        return { ok: true };
      } catch {
        return { ok: false, code: 'NETWORK' };
      }
    },
    async glow(seat, kind) {
      const target = passengers.at(seat);
      if (!target) return;
      if (session) {
        // 送出者的動畫在 ack 成功後於本機播放；伺服器不會把這則微光回送給送出者
        const res = await session.socket.timeout(4000).emitWithAck('glow:send', { to: target.pid, kind }).catch(() => null);
        if (!res?.ok) return;
      }
      showGlow(target);
    },
    wipeNote,
    async reportNote(window) {
      const note = windowNotes.get(window);
      wipeNote(window);
      if (session && note) await session.socket.timeout(4000).emitWithAck('note:report', { nid: note.nid }).catch(() => {});
    },
    currentStation,
    async signTicket(stats) {
      if (!session) return null;
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
    Object.assign(window, {
      __pax: () => passengers.all.map(p => ({ pid: p.pid, seat: p.seat, state: p.state, npc: p.npc, leaving: p.leaving })),
      __train: () => ({ from: train.from, to: train.to, phase: train.phase, speed: +train.speed.toFixed(2), inTunnel: train.inTunnel }),
      __notes: () => [...windowNotes.entries()].map(([w, n]) => ({ window: w, ...n, visible: glasses[w].hasNote })),
    });
  }

  // ── 主迴圈 ──
  let glassAcc = 0;
  let ledAcc = 0;
  let lastTunnel = train.inTunnel;
  let strapPos = 0;
  let strapVel = 0;
  let time = 0;
  mixer.setSegment(train.inTunnel ? 'underground' : 'elevated');

  app.ticker.add(ticker => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    const rm = reducedMotion.matches;
    const { rain } = store.getState();
    const now = Date.now();
    time += dt;

    train.update(dt, now);
    if (train.inTunnel !== lastTunnel) {
      lastTunnel = train.inTunnel;
      mixer.setSegment(lastTunnel ? 'underground' : 'elevated');
    }
    scenery.update(dt, train, rain, rm);
    passengers.update(dt);
    particles.update(dt);
    lighting.update(dt, train, scenery, rm);

    // 吊環：由列車加速度驅動的阻尼彈簧，到站時一起前傾
    const sway = rm ? 0 : -train.accel * 14 + (train.speed > 0.6 ? Math.sin(time * 1.3) * 0.5 : 0);
    strapVel += (sway - strapPos) * 6 * dt - strapVel * 3 * dt;
    strapPos += strapVel * dt;
    straps.forEach((s, i) => {
      const lean = Math.round(Math.max(-2, Math.min(2, strapPos + (i % 3 === 0 ? 0.3 : 0))));
      s.texture = strapArt[lean + 2];
    });

    glassAcc += dt;
    if (glassAcc >= GLASS_INTERVAL) {
      glasses.forEach(g => g.update(glassAcc, now, rain, train.speed, rm));
      glassAcc = 0;
    }

    ledAcc += dt;
    if (ledAcc >= 0.25) {
      ledAcc = 0;
      drawLed(led, train, store.getState().mode, Math.floor(time * 2) % 2 === 0);
    }

    app.renderer.render({ container: world, target: worldRT, clear: true });
    if (portrait) {
      worldInScreen.x = -camX;
      app.renderer.render({ container: screen, target: screenRT, clear: true });
    }
    if (fade.visible) {
      fadeT -= dt / 1.2;
      fade.alpha = Math.ceil(Math.max(0, fadeT) * 6) / 6;
      if (fadeT <= 0) {
        fade.visible = false;
        fade.texture.destroy(true);
      }
    }
  });
}

/** 車門上方 LED 路線圖：原創像素線條＋虛擬站點；下一站閃爍 */
function drawLed(g: Graphics, train: Train, mode: Mode, blinkOn: boolean) {
  const pal = PALETTES[mode];
  const stations = train.line.stations;
  const line = hexToNum(train.line.color);
  g.clear();
  for (const d of DOORS) {
    const x0 = d.x + 9;
    const span = d.w - 18;
    const y = 15;
    g.rect(x0, y, span, 1).fill({ color: line, alpha: 0.8 });
    stations.forEach((_, i) => {
      const x = Math.round(x0 + (i / (stations.length - 1)) * span) - 1;
      const passed = train.dir === 1 ? i < train.to : i > train.to;
      const isNext = i === train.to;
      const color = isNext ? (train.phase === 'dwell' || blinkOn ? pal.ledOn : pal.ledDim) : passed ? pal.ledDim : pal.ledOn;
      g.rect(x, y - 1, 3, 3).fill(hexToNum(color));
    });
    const ax = Math.round(x0 + (train.to / (stations.length - 1)) * span) + (train.dir === 1 ? -6 : 4);
    g.rect(ax, y - 5, 2, 1).fill(hexToNum(pal.ledOn));
  }
}
