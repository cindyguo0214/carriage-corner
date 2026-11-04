import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { needsCare } from '@cc/shared';
import { moderate } from '../src/moderation';

describe('自傷字詞（伺服器與離線用戶端共用）', () => {
  it('抓得到拆字、全形與零寬字元的寫法', () => {
    for (const text of ['今天好想死', '想 死', '想．死', '不想活了', '活不下去', '好想消失', '想​死', '自、殺']) {
      assert.equal(needsCare(text), true, text);
    }
  });

  it('一般句子不會誤判', () => {
    for (const text of ['今天要加油', '想吃滷肉飯', '好累但還撐得住', '去看海']) {
      assert.equal(needsCare(text), false, text);
    }
  });

  it('伺服器的留言過濾把它歸到關懷流程', () => {
    assert.deepEqual(moderate('想 死'), { ok: false, reason: 'care' });
    assert.deepEqual(moderate('今天要加油'), { ok: true, text: '今天要加油' });
  });
});
