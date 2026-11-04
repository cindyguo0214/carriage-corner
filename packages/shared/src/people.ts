// 乘客的名字與性別：真人自己取名（伺服器過濾），NPC 從這份名單隨機挑
import { AVATARS, NAME_MAX_GRAPHEMES, type AvatarId, type Gender, type SpecialKind } from './protocol';
import { splitGraphemes } from './text';

const NPC_NAMES: Record<Gender, string[]> = {
  m: ['阿哲', '小傑', '宇軒', '冠宇', '家豪', '柏翰', '承恩', '阿凱', '品睿', '老王'],
  f: ['小雨', '怡君', '佳穎', '品妤', '雅婷', '子晴', '阿芝', '詩涵', '小芸', '若瑜'],
};

/** taken：同一個畫面裡已經用掉的名字，盡量不重複 */
export function npcIdentity(taken: Iterable<string> = [], random: () => number = Math.random): { name: string; gender: Gender; avatar: AvatarId } {
  const gender: Gender = random() < 0.5 ? 'm' : 'f';
  const used = new Set(taken);
  const free = NPC_NAMES[gender].filter(n => !used.has(n));
  const names = free.length > 0 ? free : NPC_NAMES[gender];
  return {
    gender,
    name: names[Math.floor(random() * names.length)],
    avatar: AVATARS[Math.floor(random() * AVATARS.length)],
  };
}

const SPECIAL_NAMES: Record<SpecialKind, Record<Gender, string[]>> = {
  elder: { f: ['阿嬤', '林阿嬤', '陳阿嬤', '王阿嬤'], m: ['阿公', '林阿公', '陳阿公', '王阿公'] },
  parent: { f: ['小宇媽媽', '安安媽媽', '豆豆媽媽'], m: ['小宇爸爸', '安安爸爸', '豆豆爸爸'] },
};

/** 長者與家長 NPC：名字直接看得出身分（阿嬤、小宇媽媽） */
export function specialIdentity(kind: SpecialKind, taken: Iterable<string> = [], random: () => number = Math.random) {
  // 拎菜籃的多半是阿嬤
  const gender: Gender = random() < (kind === 'elder' ? 0.7 : 0.5) ? 'f' : 'm';
  const used = new Set(taken);
  const all = SPECIAL_NAMES[kind][gender];
  const free = all.filter(n => !used.has(n));
  const names = free.length > 0 ? free : all;
  return { gender, name: names[Math.floor(random() * names.length)], avatar: kind as AvatarId };
}

/** 去掉控制字元、合併空白、截到 max 個字 */
export function tidyName(raw: string, max = NAME_MAX_GRAPHEMES): string {
  const text = raw.normalize('NFKC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim();
  return splitGraphemes(text).slice(0, max).join('');
}
