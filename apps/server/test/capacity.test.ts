import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { HARD_CAP, isStand, STAND_CAP } from '@cc/shared';
import type { Config } from '../src/config';
import { RoomManager } from '../src/rooms/RoomManager';

const cfg: Config = {
  port: 0,
  webOrigin: '*',
  runSec: [60, 60],
  dwellSec: 20,
  platformWaitSec: 60,
  platformLeadSec: [10, 10],
  graceSec: 1,
  noteTtlSec: 60,
  npcWarmth: 4,
  tokenSecret: 'test-secret',
};

describe('車廂容量：座位為核心、走道為彈性（docs/PRD.md §24.2）', () => {
  const rooms = new RoomManager(cfg, () => () => {});
  after(() => rooms.disposeAll());
  const who = (i: number) => ({ name: `旅人${i}`, gender: 'f' as const, avatar: 'office' as const });

  it('12 個座位坐滿真人後，後來的人站走道拉吊環，最多 18 人', () => {
    const room = rooms.assign('CX');
    const humans = [];
    for (let i = 0; i < HARD_CAP; i++) humans.push(room.seatHuman(`s${i}`, who(i)));
    assert.ok(humans.every(p => !isStand(p.seat)), '前 12 人都有座位（NPC 讓座給真人）');
    for (let i = HARD_CAP; i < STAND_CAP; i++) {
      assert.ok(room.hasRoomForHuman, `第 ${i + 1} 人還進得來`);
      assert.ok(isStand(room.seatHuman(`s${i}`, who(i)).seat), `第 ${i + 1} 人站著`);
    }
    assert.equal(room.realCount, STAND_CAP);
    assert.equal(room.hasRoomForHuman, false, '座位與站位都是真人時就滿了');
  });
});
