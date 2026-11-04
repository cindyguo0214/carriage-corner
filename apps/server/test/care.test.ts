import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasDeniedWord, needsCare } from '@cc/shared';
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

describe('髒話詞庫（伺服器與離線用戶端共用）', () => {
  it('抓得到拆字與全形的寫法', () => {
    for (const text of ['你這個白痴', '智 障', '去．死啦', '賤人']) {
      assert.equal(hasDeniedWord(text), true, text);
    }
  });

  it('一般句子不會誤判', () => {
    for (const text of ['今天要加油', '去看海', '垃圾分類做好了']) {
      assert.equal(hasDeniedWord(text), false, text);
    }
  });

  it('伺服器的留言過濾把它擋下', () => {
    assert.deepEqual(moderate('智 障'), { ok: false, reason: 'deny' });
  });
});
