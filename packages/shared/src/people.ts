// 乘客的名字與性別：真人自己取名（伺服器過濾），NPC 從這份名單隨機挑
import { AVATARS, NAME_MAX_GRAPHEMES, type AvatarId, type Gender } from './protocol';
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

/** 去掉控制字元、合併空白、截到 max 個字 */
export function tidyName(raw: string, max = NAME_MAX_GRAPHEMES): string {
  const text = raw.normalize('NFKC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim();
  return splitGraphemes(text).slice(0, max).join('');
}
