import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { BoardedSnapshot, ClientToServer, LineId, ServerToClient } from '@cc/shared';
import { createRealtimeServer, type RealtimeServer } from '../src/app';
import type { Config } from '../src/config';

type Client = Socket<ServerToClient, ClientToServer>;

const cfg: Config = {
  port: 0,
  webOrigin: '*',
  runSec: [0.6, 0.6],
  dwellSec: 0.4,
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

after(async () => {
  clients.forEach(c => c.disconnect());
  await server.close();
});

function open(): Client {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(c);
  return c;
}

async function board(line: LineId = 'CX', opts: { sid?: string; resumeToken?: string | null; client?: Client } = {}) {
  const client = opts.client ?? open();
  const sid = opts.sid ?? `test-sid-${++sidSeq}-xxxx`;
  const res = await client.timeout(2000).emitWithAck('board', {
    sid, resumeToken: opts.resumeToken ?? null, line, avatar: 'office', passCard: 'tile',
  });
  assert.ok(res.ok, `board failed: ${JSON.stringify(res)}`);
  return { client, sid, snap: (res as { data: BoardedSnapshot }).data };
}

const once = <E extends keyof ServerToClient>(c: Client, event: E, ms = 2000) =>
  new Promise<Parameters<ServerToClient[E]>[0]>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    (c as unknown as { once(e: string, fn: (p: unknown) => void): void }).once(event, p => {
      clearTimeout(t);
      resolve(p as Parameters<ServerToClient[E]>[0]);
    });
  });

describe('realtime server', () => {
  it('同一條線的乘客坐進同一節車廂，後到的人從貫通道走進來', async () => {
    const a = await board('SK');
    const joined = once(a.client, 'pax:join');
    const b = await board('SK');
    assert.equal(a.snap.room.id, b.snap.room.id);
    const join = await joined;
    assert.equal(join.pid, b.snap.you.pid);
    assert.equal(join.via, 'gangway');
    assert.notEqual(a.snap.you.seat, b.snap.you.seat);
    assert.ok(b.snap.passengers.some(p => p.npc), '新車廂應有 NPC 補足熱度');
    assert.equal(new Set(b.snap.passengers.map(p => p.seat)).size, b.snap.passengers.length, '座位不可重複');
  });

  it('第 9 位乘客仍分到同一節（未滿 12 人前不加開），不同路線分到不同車廂', async () => {
    const riders = [];
    for (let i = 0; i < 9; i++) riders.push(await board('RV'));
    const roomIds = new Set(riders.map(r => r.snap.room.id));
    assert.equal(roomIds.size, 1, '第 9 人仍應進同一節（8 人後改挑人最少的未滿車廂）');
    const other = await board('CX');
    assert.ok(!roomIds.has(other.snap.room.id));
  });

  it('微光廣播不帶送出者，送出者自己也不會收到', async () => {
    const a = await board('CX');
    const b = await board('CX');
    let senderGotGlow = false;
    a.client.on('glow', () => (senderGotGlow = true));
    const received = once(b.client, 'glow');
    const res = await a.client.timeout(2000).emitWithAck('glow:send', { to: b.snap.you.pid, kind: 'coffee' });
    assert.deepEqual(res, { ok: true });
    const glow = await received;
    assert.deepEqual(Object.keys(glow).sort(), ['at', 'kind', 'to']);
    assert.equal(glow.to, b.snap.you.pid);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(senderGotGlow, false);

    const again = await a.client.timeout(2000).emitWithAck('glow:send', { to: b.snap.you.pid, kind: 'cheer' });
    assert.deepEqual(again, { ok: false, code: 'RATE_LIMITED' }, '對同一人 2 分鐘內只能送一次');
  });

  it('勿擾時伺服器靜默丟棄，送出者仍收到成功', async () => {
    const a = await board('CX');
    const b = await board('CX');
    await b.client.timeout(2000).emitWithAck('pref:set', { dnd: true });
    let got = false;
    b.client.on('glow', () => (got = true));
    const res = await a.client.timeout(2000).emitWithAck('glow:send', { to: b.snap.you.pid, kind: 'coffee' });
    assert.deepEqual(res, { ok: true });
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

  it('拒絕格式錯誤的請求', async () => {
    const c = open();
    const res = await c.timeout(2000).emitWithAck('board', { sid: 'x', line: 'BL' } as never);
    assert.deepEqual(res, { ok: false, code: 'BAD_REQUEST' });
  });
});
