import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { CARS, type BoardedSnapshot, type ClientToServer, type LineId, type PlatformArrival, type ServerToClient } from '@cc/shared';
import { createRealtimeServer, type RealtimeServer } from '../src/app';
import type { Config } from '../src/config';

type Client = Socket<ServerToClient, ClientToServer>;

const cfg: Config = {
  port: 0,
  webOrigin: '*',
  runSec: [0.6, 0.6],
  dwellSec: 0.4,
  platformWaitSec: 0.5,
  platformLeadSec: [0.6, 0.6],
  graceSec: 0.05,
  noteTtlSec: 60,
  npcWarmth: 4,
  tokenSecret: 'test-secret',
};

let server: RealtimeServer;
let url: string;
const clients: Client[] = [];
let sidSeq = 0;

before(async () => {
  server = createRealtimeServer(cfg);
  await new Promise<void>(resolve => server.http.listen(0, resolve));
  url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
});

// 每個測試從空的路網開始，避免前一個測試的乘客影響分流
afterEach(() => {
  clients.splice(0).forEach(c => c.disconnect());
  server.rooms.disposeAll();
});

after(async () => {
  await server.close();
});

function open(): Client {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(c);
  return c;
}

async function board(
  line: LineId = 'CX',
  opts: { sid?: string; resumeToken?: string | null; client?: Client; name?: string } = {},
) {
  const client = opts.client ?? open();
  const sid = opts.sid ?? `test-sid-${++sidSeq}-xxxx`;
  const res = await client.timeout(2000).emitWithAck('board', {
    sid, resumeToken: opts.resumeToken ?? null, line, name: opts.name ?? '小安', gender: 'f', avatar: 'office', passCard: 'tile',
  });
  assert.ok(res.ok, `board failed: ${JSON.stringify(res)}`);
  return { client, sid, snap: (res as { data: BoardedSnapshot }).data };
}

const PRIORITY = new Set(['1A', '1B', '6A', '6B']);

const once = <E extends keyof ServerToClient>(c: Client, event: E, ms = 2000) =>
  new Promise<Parameters<ServerToClient[E]>[0]>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    (c as unknown as { once(e: string, fn: (p: unknown) => void): void }).once(event, p => {
      clearTimeout(t);
      resolve(p as Parameters<ServerToClient[E]>[0]);
    });
  });

describe('realtime server', () => {
  it('同一條線的乘客坐進同一節車廂，後到的人從車門走進來，頭上帶著名字', async () => {
    const a = await board('SK');
    const joined = once(a.client, 'pax:join');
    const b = await board('SK');
    assert.equal(a.snap.room.id, b.snap.room.id);
    const join = await joined;
    assert.equal(join.pid, b.snap.you.pid);
    assert.equal(join.via, 'door');
    assert.equal(join.name, '小安');
    assert.equal(join.gender, 'f');
    assert.notEqual(a.snap.you.seat, b.snap.you.seat);
    assert.ok(b.snap.passengers.some(p => p.npc), '新車廂應有 NPC 補足熱度');
    assert.equal(new Set(b.snap.passengers.map(p => p.seat)).size, b.snap.passengers.length, '座位不可重複');
  });

  it('一節坐滿 8 人後，第 9 位走進同一列車的另一節；不同路線分到不同列車', async () => {
    const riders = [];
    for (let i = 0; i < 9; i++) riders.push(await board('RV'));
    const first8 = new Set(riders.slice(0, 8).map(r => r.snap.room.id));
    assert.equal(first8.size, 1, '前 8 人應坐進同一節');
    const ninth = riders[8].snap.room;
    assert.ok(!first8.has(ninth.id), '第 9 人改坐別節，不擠博愛座');
    assert.equal(ninth.train, riders[0].snap.room.train, '仍是同一列車');
    assert.equal(ninth.cars, CARS);
    const other = await board('CX');
    assert.notEqual(other.snap.room.train, ninth.train);
  });

  it('微光廣播不帶送出者，送出者自己也不會收到', async () => {
    const a = await board('CX');
    const b = await board('CX');
    let senderGotGlow = false;
    a.client.on('glow', () => (senderGotGlow = true));
    const received = once(b.client, 'glow');
    const res = await a.client.timeout(2000).emitWithAck('glow:send', { to: b.snap.you.pid, kind: 'beep' });
    assert.deepEqual(res, { ok: true, data: { fortune: null } });
    const glow = await received;
    assert.deepEqual(Object.keys(glow).sort(), ['at', 'fortune', 'kind', 'to']);
    assert.equal(glow.to, b.snap.you.pid);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(senderGotGlow, false);
  });

  it('車廂裡也能打招呼：對方收到 hi', async () => {
    const a = await board('SK');
    const b = await board('SK');
    const received = once(b.client, 'glow');
    const res = await a.client.timeout(2000).emitWithAck('glow:send', { to: b.snap.you.pid, kind: 'hi' });
    assert.deepEqual(res, { ok: true, data: { fortune: null } });
    assert.equal((await received).kind, 'hi');
  });

  it('遞幸運籤：送出者與收到的人拿到同一支籤；小毯只能蓋給正在補眠的人', async () => {
    const a = await board('RV');
    const b = await board('RV');
    const received = once(b.client, 'glow');
    const res = await a.client.timeout(2000).emitWithAck('glow:send', { to: b.snap.you.pid, kind: 'fortune' });
    assert.ok(res.ok);
    const fortune = (res as { data: { fortune: number | null } }).data.fortune;
    assert.equal(typeof fortune, 'number');
    assert.equal((await received).fortune, fortune);

    const c = await board('RV');
    assert.deepEqual(
      await a.client.timeout(2000).emitWithAck('glow:send', { to: c.snap.you.pid, kind: 'blanket' }),
      { ok: false, code: 'NO_TARGET' },
    );
    await c.client.timeout(2000).emitWithAck('state:set', { state: 'sleep' });
    const covered = once(c.client, 'glow');
    assert.ok((await a.client.timeout(2000).emitWithAck('glow:send', { to: c.snap.you.pid, kind: 'blanket' })).ok);
    assert.equal((await covered).kind, 'blanket');
  });

  it('勿擾時伺服器靜默丟棄，送出者仍收到成功', async () => {
    const a = await board('CX');
    const b = await board('CX');
    await b.client.timeout(2000).emitWithAck('pref:set', { dnd: true });
    let got = false;
    b.client.on('glow', () => (got = true));
    const res = await a.client.timeout(2000).emitWithAck('glow:send', { to: b.snap.you.pid, kind: 'beep' });
    assert.deepEqual(res, { ok: true, data: { fortune: null } });
    await new Promise(r => setTimeout(r, 150));
    assert.equal(got, false);
  });

  it('霧氣留言：聯絡方式被擋、自傷字詞走關懷流程、正常留言全車可見且每站限一則', async () => {
    const a = await board('SK');
    const b = await board('SK');
    const write = (text: string) => a.client.timeout(2000).emitWithAck('note:write', { text });

    assert.deepEqual(await write('加我 line: abc123'), { ok: false, code: 'FILTERED' });
    assert.deepEqual(await write('今天好想死'), { ok: false, code: 'CARE' });
    assert.deepEqual(await write('一二三四五六七八九十一二三四五六'), { ok: false, code: 'FILTERED' });

    const seen = once(b.client, 'note:new');
    const ok = await write('今天我要把報告寫完');
    assert.equal(ok.ok, true);
    const note = await seen;
    assert.equal(note.text, '今天我要把報告寫完');
    assert.equal(note.window, Number(a.snap.you.seat[0]) - 1);
    assert.ok(!('authorSid' in note), '不可外流作者資訊');

    assert.deepEqual(await write('再寫一句'), { ok: false, code: 'RATE_LIMITED' });
  });

  it('3 位不同乘客檢舉後留言從全車移除', async () => {
    const author = await board('CX');
    const res = await author.client.timeout(2000).emitWithAck('note:write', { text: '測試檢舉' });
    assert.ok(res.ok);
    const nid = (res as { data: { nid: string } }).data.nid;
    const reporters = [await board('CX'), await board('CX'), await board('CX')];
    const gone = once(author.client, 'note:gone');
    for (const r of reporters) await r.client.timeout(2000).emitWithAck('note:report', { nid });
    assert.deepEqual(await gone, { nid });
  });

  it('斷線後用 resumeToken 回到原本的座位；他人看到先補眠再醒來', async () => {
    const a = await board('RV');
    const b = await board('RV');
    assert.equal(a.snap.room.id, b.snap.room.id);
    await a.client.timeout(2000).emitWithAck('state:set', { state: 'read' });
    const asleep = once(b.client, 'pax:state');
    a.client.disconnect();
    assert.deepEqual(
      { pid: (await asleep).pid, state: (await asleep).state },
      { pid: a.snap.you.pid, state: 'sleep' },
    );
    const awake = once(b.client, 'pax:state');
    const back = await board('RV', { sid: a.sid, resumeToken: a.snap.resumeToken });
    assert.equal(back.snap.you.pid, a.snap.you.pid);
    assert.equal(back.snap.you.seat, a.snap.you.seat);
    assert.equal((await awake).state, 'read');
  });

  it('列車到站與發車：離線超過寬限時間的乘客在到站時下車', async () => {
    const a = await board('SK');
    const b = await board('SK');
    const arrive = once(b.client, 'train:arrive', 3000);
    a.client.disconnect();
    const ev = await arrive;
    assert.match(ev.station, /^SK0\d$/);
    assert.equal(ev.doorsOpenMs, 400);
    assert.ok(ev.leaving.includes(a.snap.you.pid));
    const depart = await once(b.client, 'train:depart', 3000);
    assert.equal(depart.train.from, ev.station);
    assert.ok(depart.train.arriveAt > depart.train.departAt);
  });

  it('名字也會過濾：聯絡方式改用替代名，過長的名字截斷', async () => {
    const a = await board('CX', { name: '加我line: abc123' });
    assert.equal(a.snap.you.name, '旅人');
    const b = await board('CX', { name: '  一二三四五六七八九十  ' });
    assert.equal(b.snap.you.name, '一二三四五六七八');
  });

  it('換座位：只能換到空位，也可以站著拉吊環，同車的人看到移動', async () => {
    const a = await board('SK');
    const b = await board('SK');
    const free = (['1A', '2A', '3A', '4A', '5A', '6A', '1B', '2B', '3B', '4B', '5B', '6B'] as const)
      .find(s => !b.snap.passengers.some(p => p.seat === s))!;
    const moved = once(b.client, 'pax:move');
    assert.deepEqual(await a.client.timeout(2000).emitWithAck('seat:move', { seat: free }), { ok: true });
    assert.deepEqual(await moved, { pid: a.snap.you.pid, seat: free });
    assert.deepEqual(
      await a.client.timeout(2000).emitWithAck('seat:move', { seat: b.snap.you.seat }),
      { ok: false, code: 'NO_TARGET' },
    );
    // 站到走道上拉吊環，寫字時用的是那一欄的車窗
    assert.deepEqual(await a.client.timeout(2000).emitWithAck('seat:move', { seat: 'S4' }), { ok: true });
    const seen = once(b.client, 'note:new');
    assert.ok((await a.client.timeout(2000).emitWithAck('note:write', { text: '站著也很好' })).ok);
    assert.equal((await seen).window, 3);
  });

  it('經貫通道換車廂：同一列車的相鄰車廂，原車廂的人看到離開', async () => {
    const a = await board('RV');
    const b = await board('RV');
    assert.equal(a.snap.room.id, b.snap.room.id);
    const left = once(b.client, 'pax:leave');
    const dir = a.snap.room.car > 1 ? -1 : 1;
    const res = await a.client.timeout(2000).emitWithAck('car:move', { dir });
    assert.ok(res.ok);
    const snap = (res as { data: BoardedSnapshot }).data;
    assert.equal(snap.room.train, a.snap.room.train);
    assert.equal(snap.room.car, a.snap.room.car + dir);
    assert.equal(snap.you.pid, a.snap.you.pid);
    assert.equal(snap.you.name, a.snap.you.name);
    assert.deepEqual(await left, { pid: a.snap.you.pid, reason: 'transfer' });
    const edge = snap.room.car === 1 ? -1 : snap.room.car === snap.room.cars ? 1 : null;
    if (edge) {
      assert.deepEqual(await a.client.timeout(2000).emitWithAck('car:move', { dir: edge }), { ok: false, code: 'NO_TARGET' });
    }
  });

  it('下車：行駛中不能下車，到站開門後可以，同車的人看到離開', async () => {
    const a = await board('SK');
    const b = await board('SK');
    const phase = await new Promise<'run' | 'dwell'>(resolve => {
      const t = Date.now();
      const s = a.snap.train;
      resolve(t >= s.arriveAt && t < s.arriveAt + s.dwellMs ? 'dwell' : 'run');
    });
    if (phase === 'run') {
      const early = await a.client.timeout(2000).emitWithAck('alight', {});
      assert.deepEqual(early, { ok: false, code: 'NO_TARGET' });
    }
    await once(a.client, 'train:arrive', 3000);
    assert.equal(a.snap.room.id, b.snap.room.id);
    const left = once(b.client, 'pax:leave');
    assert.deepEqual(await a.client.timeout(2000).emitWithAck('alight', {}), { ok: true });
    assert.deepEqual(await left, { pid: a.snap.you.pid, reason: 'station' });
    // 下車後回到月台，還能搭下一班車
    const again = await a.client.timeout(2000).emitWithAck('board', {
      sid: a.sid, resumeToken: null, line: 'SK', name: '小安', gender: 'f', avatar: 'office', passCard: 'tile',
    });
    assert.ok(again.ok);
  });

  describe('從月台上車（docs/PRD.md 第 19 章）', () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const next = async (c: Client, line: LineId, station: number) => {
      const res = await c.timeout(2000).emitWithAck('platform:next', { line, station });
      assert.ok(res.ok, JSON.stringify(res));
      return (res as { data: PlatformArrival }).data;
    };
    const boardAt = (c: Client, line: LineId, station: number, train: string) =>
      c.timeout(2000).emitWithAck('board', {
        sid: `test-sid-${++sidSeq}-xxxx`, resumeToken: null, line, name: '小安', gender: 'f', avatar: 'office', passCard: 'tile', station, train,
      });

    it('沒有列車會來時預定從這站加開一班；進站前上不了車，開門後上車就停在這一站', async () => {
      const a = open();
      const arrival = await next(a, 'RV', 3);
      assert.ok(arrival.arriveAt > Date.now());
      assert.equal(arrival.departAt - arrival.arriveAt, cfg.dwellSec * 1000);
      assert.deepEqual(await boardAt(a, 'RV', 3, arrival.train), { ok: false, code: 'MISSED' });

      // 同一站的人等的是同一班
      const b = open();
      assert.equal((await next(b, 'RV', 3)).train, arrival.train);

      await sleep(arrival.arriveAt - Date.now() + 30);
      const ra = await boardAt(a, 'RV', 3, arrival.train);
      assert.ok(ra.ok, JSON.stringify(ra));
      const snap = (ra as { data: BoardedSnapshot }).data;
      assert.equal(snap.room.train, arrival.train);
      assert.equal(snap.train.to, 'RV04');
      assert.ok(snap.train.arriveAt <= Date.now());

      const rb = await boardAt(b, 'RV', 3, arrival.train);
      assert.ok(rb.ok);
      assert.equal((rb as { data: BoardedSnapshot }).data.room.id, snap.room.id);
    });

    it('現有列車很快會停靠這站時，等的就是那一班', async () => {
      const rider = await board('CX');
      const station = Number(rider.snap.train.to.slice(2)) - 1;
      const arrival = await next(open(), 'CX', station);
      assert.equal(arrival.train, rider.snap.room.train);
      assert.equal(arrival.arriveAt, rider.snap.train.arriveAt);
    });

    it('車門關上開走之後就搭不上了', async () => {
      const a = open();
      const arrival = await next(a, 'SK', 0);
      assert.equal(arrival.dir, 1);
      await sleep(arrival.departAt - Date.now() + 2100);
      assert.deepEqual(await boardAt(a, 'SK', 0, arrival.train), { ok: false, code: 'MISSED' });
    });

    it('車站超出路線範圍時拒絕', async () => {
      const res = await open().timeout(2000).emitWithAck('platform:next', { line: 'CX', station: 7 });
      assert.deepEqual(res, { ok: false, code: 'BAD_REQUEST' });
    });
  });

  describe('讓座與影子靜音（docs/PRD.md 第 20 章）', () => {
    const silent = (c: Client, event: keyof ServerToClient, ms = 250) =>
      new Promise<boolean>(resolve => {
        const fn = () => resolve(false);
        (c as unknown as { once(e: string, f: () => void): void }).once(event, fn);
        setTimeout(() => resolve(true), ms);
      });

    it('博愛座坐滿時長者站著；坐在博愛座的人讓座後兩人換位，同車的人看到道謝', async () => {
      const a = await board('RV');
      const b = await board('RV');
      assert.equal(a.snap.room.id, b.snap.room.id);
      const room = server.rooms.get(a.snap.room.id)!;
      // 讓 a 坐到博愛座 1A，其餘博愛座由長者坐滿
      for (const s of ['1A', '1B', '6A', '6B'] as const) {
        const someone = [...room.pax.values()].find(p => p.seat === s && p.pid !== a.snap.you.pid);
        if (someone) room.pax.delete(someone.pid);
      }
      assert.deepEqual(await a.client.timeout(2000).emitWithAck('seat:move', { seat: '1A' }), { ok: true });
      for (let i = 0; i < 3; i++) assert.ok(PRIORITY.has(room.boardSpecial('elder')!.seat));
      const parent = room.boardSpecial('parent')!;
      assert.equal(parent.seat, 'S1');
      assert.equal(parent.avatar, 'parent');

      const moves: { pid: string; seat: string }[] = [];
      b.client.on('pax:move', m => moves.push(m));
      const thanks = once(b.client, 'pax:thanks');
      const res = await a.client.timeout(2000).emitWithAck('seat:yield', { to: parent.pid });
      assert.deepEqual(res, { ok: true, data: { seat: 'S1' } });
      assert.equal((await thanks).pid, parent.pid);
      assert.equal(room.pax.get(parent.pid)!.seat, '1A');
      assert.equal(room.pax.get(a.snap.you.pid)!.seat, 'S1');
      assert.deepEqual(moves.sort((x, y) => x.pid.localeCompare(y.pid)), [
        { pid: a.snap.you.pid, seat: 'S1' }, { pid: parent.pid, seat: '1A' },
      ].sort((x, y) => x.pid.localeCompare(y.pid)));
    });

    it('大站人潮把座位（含博愛座）坐滿後，上車的長者只能站著', async () => {
      const a = await board('CX');
      const room = server.rooms.get(a.snap.room.id)!;
      room.rush();
      const seated = [...room.pax.values()].filter(p => !p.seat.startsWith('S')).length;
      assert.equal(seated, 12);
      assert.equal(room.boardSpecial('elder')!.seat, 'S1');
    });

    it('離博愛座太遠、或對方沒站著時不能讓座', async () => {
      const a = await board('SK');
      const room = server.rooms.get(a.snap.room.id)!;
      const elder = room.boardSpecial('elder')!;
      assert.ok(PRIORITY.has(elder.seat), '有空的博愛座就直接坐');
      assert.deepEqual(await a.client.timeout(2000).emitWithAck('seat:yield', { to: elder.pid }), { ok: false, code: 'NO_TARGET' });
    });

    it('一直對同一個人互動：送出者照常成功，但多出來的被吸收；被擋 3 次後對誰都送不出去', async () => {
      const a = await board('CX');
      const b = await board('CX');
      const c = await board('CX');
      assert.equal(a.snap.room.id, c.snap.room.id);
      const send = (to: string) => a.client.timeout(2000).emitWithAck('glow:send', { to, kind: 'beep' });
      for (let i = 0; i < 2; i++) {
        const got = once(b.client, 'glow');
        assert.ok((await send(b.snap.you.pid)).ok);
        await got;
      }
      for (let i = 0; i < 3; i++) {
        const quiet = silent(b.client, 'glow');
        assert.deepEqual(await send(b.snap.you.pid), { ok: true, data: { fortune: null } });
        assert.ok(await quiet, '第 3 次以後不該送到');
      }
      const quiet = silent(c.client, 'glow');
      assert.ok((await send(c.snap.you.pid)).ok);
      assert.ok(await quiet, '影子靜音期間，換個人也送不出去');
    });
  });

  it('拒絕格式錯誤的請求', async () => {
    const c = open();
    const res = await c.timeout(2000).emitWithAck('board', { sid: 'x', line: 'BL' } as never);
    assert.deepEqual(res, { ok: false, code: 'BAD_REQUEST' });
  });
});
