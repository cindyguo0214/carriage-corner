// 文字處理：字數以字素（grapheme）計算，emoji 與組合字都算 1 個字

export function splitGraphemes(text: string): string[] {
  const seg = new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' });
  return [...seg.segment(text)].map(s => s.segment);
}

/** 用戶端預先攔截聯絡方式（網址、電話、@帳號、LINE ID）；伺服器仍會再過濾一次（docs/PRD.md §7.7） */
export function looksLikeContact(text: string): boolean {
  const t = text.normalize('NFKC').replace(/[​-‍﻿\s]/g, '').toLowerCase();
  return /https?:|www\.|\.(com|tw|net|io|me)\b|@[a-z0-9_.]{2,}|line(id)?[:：]?[a-z0-9_.-]{3,}|\d{6,}|09\d{2}-?\d{3}-?\d{3}/.test(t);
}
