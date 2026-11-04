// 霧氣留言過濾（docs/PRD.md §7.7）：正規化 → 長度 → 自傷字詞（關懷流程）→ 聯絡方式 → 詞庫；兩份字詞表都在 @cc/shared
import { hasDeniedWord, looksLikeContact, needsCare, NOTE_MAX_GRAPHEMES, splitGraphemes } from '@cc/shared';

export type Verdict =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'length' | 'contact' | 'deny' | 'care' };

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function moderate(raw: string, maxGraphemes = NOTE_MAX_GRAPHEMES): Verdict {
  const text = normalize(raw);
  if (!text) return { ok: false, reason: 'empty' };
  if (splitGraphemes(text).length > maxGraphemes) return { ok: false, reason: 'length' };
  if (needsCare(text)) return { ok: false, reason: 'care' };
  if (looksLikeContact(text)) return { ok: false, reason: 'contact' };
  if (hasDeniedWord(text)) return { ok: false, reason: 'deny' };
  return { ok: true, text };
}

export class Moderation {
  notesPaused = process.env.NOTES_PAUSED === '1';
  private reports = new Map<string, Set<string>>();
  private muted = new Map<string, number>();

  /** 回傳 true 代表這則留言已達隱藏門檻（3 個不同 sid 檢舉） */
  report(nid: string, reporterSid: string): boolean {
    const set = this.reports.get(nid) ?? new Set<string>();
    set.add(reporterSid);
    this.reports.set(nid, set);
    return set.size >= 3;
  }

  /** 影子靜音：作者自己看得到，別人看不到 */
  mute(sid: string, hours = 24) {
    this.muted.set(sid, Date.now() + hours * 3_600_000);
  }

  isMuted(sid: string) {
    const until = this.muted.get(sid);
    if (!until) return false;
    if (until < Date.now()) {
      this.muted.delete(sid);
      return false;
    }
    return true;
  }

  forget(nid: string) {
    this.reports.delete(nid);
  }
}
