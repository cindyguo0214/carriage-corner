// 文字處理：字數以字素（grapheme）計算，emoji 與組合字都算 1 個字

export function splitGraphemes(text: string): string[] {
  const seg = new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' });
  return [...seg.segment(text)].map(s => s.segment);
}

// 自傷字詞（docs/PRD.md §7.7）：命中時不廣播，改在本人畫面溫柔顯示求助資源。
// 伺服器與用戶端共用；離線模式沒有伺服器，只靠用戶端這一層。初版只放少量示意，正式版改由可熱更新的設定檔載入。
const CARE_WORDS = ['想死', '自殺', '不想活', '活不下去', '想消失', '結束生命'];

/** 比對用：全形轉半形、拿掉零寬字元、空白與標點，擋「想 死」「想.死」這類拆字 */
export function squashForMatch(text: string): string {
  return text.normalize('NFKC').replace(/[​-‍﻿]/g, '').replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 含自傷字詞：要走關懷流程（顯示 1925 安心專線），不要公開 */
export function needsCare(text: string): boolean {
  const flat = squashForMatch(text);
  return CARE_WORDS.some(w => flat.includes(w));
}

/** 用戶端預先攔截聯絡方式（網址、電話、@帳號、LINE ID）；伺服器仍會再過濾一次（docs/PRD.md §7.7） */
export function looksLikeContact(text: string): boolean {
  const t = text.normalize('NFKC').replace(/[​-‍﻿\s]/g, '').toLowerCase();
  return /https?:|www\.|\.(com|tw|net|io|me)\b|@[a-z0-9_.]{2,}|line(id)?[:：]?[a-z0-9_.-]{3,}|\d{6,}|09\d{2}-?\d{3}-?\d{3}/.test(t);
}
