// 遞幸運籤：今日小籤。只傳索引，不傳任何使用者文字（docs/PRD.md 第 17 章）

export interface Fortune {
  grade: '大吉' | '中吉' | '小吉';
  text: string;
}

export const FORTUNES: Fortune[] = [
  { grade: '小吉', text: '今日搭車必定有座' },
  { grade: '中吉', text: '簡報順利，掌聲會來' },
  { grade: '小吉', text: '下一班車剛好進站' },
  { grade: '大吉', text: '今晚一夜好眠' },
  { grade: '小吉', text: '午餐會遇到好吃的' },
  { grade: '中吉', text: '想聯絡的人會先傳訊息來' },
  { grade: '小吉', text: '出站時不會下雨' },
  { grade: '中吉', text: '卡關的事今天會鬆動' },
  { grade: '大吉', text: '你比自己想的還厲害' },
  { grade: '小吉', text: '耳機裡會播到喜歡的歌' },
  { grade: '中吉', text: '今天的努力有人看見' },
  { grade: '小吉', text: '回家路上有晚風' },
];

export const fortuneAt = (i: number) => FORTUNES[((i % FORTUNES.length) + FORTUNES.length) % FORTUNES.length];
