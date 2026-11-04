// Low-Fi 莫蘭迪低飽和色票（docs/PRD.md §2.2）。正式版收斂為 48 色主調色盤 .gpl。
import type { AvatarId, Gender, Mode } from '@cc/shared';

export interface Palette {
  wall: string; wallShade: string; wallHi: string;
  ceiling: string; ceilingLight: string;
  floor: string; floorShade: string;
  metal: string; metalHi: string; metalLo: string;
  seat: Record<'blue' | 'yellow' | 'priority', { base: string; hi: string; lo: string }>;
  door: string; doorLo: string;
  led: string; ledOn: string; ledDim: string;
  skyTop: string; skyBottom: string; far: string; mid: string; midLo: string; near: string;
  windowLit: string; water: string; waterHi: string;
  tunnel: string; tunnelLo: string; tunnelLight: string;
  platformWall: string; platformTile: string; warning: string;
  fog: string; light: string; glow: string;
  skin: string; skinLo: string; shoe: string; paper: string; eye: string;
  neon: string[];
}

export const PALETTES: Record<Mode, Palette> = {
  morning: {
    wall: '#E8E1D5', wallShade: '#D6CDBE', wallHi: '#F1ECE3',
    ceiling: '#EFEAE1', ceilingLight: '#FFF6E6',
    floor: '#B9B0A3', floorShade: '#A79E92',
    metal: '#B8B4AC', metalHi: '#DAD6CE', metalLo: '#8F8B84',
    seat: {
      blue: { base: '#8FA3B5', hi: '#A7B8C7', lo: '#71879A' },
      yellow: { base: '#D8C49A', hi: '#E6D6B2', lo: '#B9A57C' },
      priority: { base: '#5F6F86', hi: '#74839A', lo: '#4B5A70' },
    },
    door: '#CFC7BA', doorLo: '#B3AA9C',
    led: '#2F2D33', ledOn: '#E6C9A8', ledDim: '#5A5560',
    skyTop: '#BFCED8', skyBottom: '#ECE5DA', far: '#B4C0C2', mid: '#9FABAE', midLo: '#8B979B', near: '#7E8985',
    windowLit: '#C3CCD0', water: '#A9BCC1', waterHi: '#CBD8DA',
    tunnel: '#4B4A50', tunnelLo: '#3A393F', tunnelLight: '#F3E9DA',
    platformWall: '#D9D2C6', platformTile: '#C8C0B3', warning: '#D4A373',
    fog: '#F4F1EC', light: '#E6C9A8', glow: '#F3E9DA',
    skin: '#E8C8B0', skinLo: '#D4AE95', shoe: '#4E4844', paper: '#F3E9DA', eye: '#4A4744',
    neon: ['#E6C9A8'],
  },
  night: {
    wall: '#4A4756', wallShade: '#3F3C4A', wallHi: '#57536A',
    ceiling: '#55515F', ceilingLight: '#F1E3CF',
    floor: '#3E3B47', floorShade: '#36333F',
    metal: '#7D7B80', metalHi: '#A19EA2', metalLo: '#5E5C62',
    seat: {
      blue: { base: '#6B7D8E', hi: '#7F90A0', lo: '#566676' },
      yellow: { base: '#A89878', hi: '#BBAC8C', lo: '#8C7E62' },
      priority: { base: '#4C5868', hi: '#5D6979', lo: '#3D4857' },
    },
    door: '#55515E', doorLo: '#47434F',
    led: '#1E1D22', ledOn: '#D9B98C', ledDim: '#3E3B44',
    skyTop: '#2B2F40', skyBottom: '#4D4459', far: '#3A3A4C', mid: '#2F2F3E', midLo: '#28283A', near: '#23222D',
    windowLit: '#D9B98C', water: '#353D50', waterHi: '#55607A',
    tunnel: '#2A2930', tunnelLo: '#212026', tunnelLight: '#F1E3CF',
    platformWall: '#5A5664', platformTile: '#4E4A58', warning: '#A88A63',
    fog: '#CFCBD6', light: '#D9B98C', glow: '#F1E3CF',
    skin: '#C9A994', skinLo: '#B08F7C', shoe: '#2C2A2E', paper: '#E3D6C3', eye: '#2C2A2E',
    neon: ['#C98BA0', '#7FA9A3', '#D4A373'],
  },
};

export interface Outfit { top: string; topLo: string; bottom: string; hair: string; acc: string }

const OUTFITS: Record<AvatarId, Record<Gender, Outfit>> = {
  office: {
    m: { top: '#7E8A9A', topLo: '#687384', bottom: '#5E6470', hair: '#3D3836', acc: '#E4DED3' },
    f: { top: '#A39AA8', topLo: '#8A8290', bottom: '#5E6470', hair: '#4A3E3A', acc: '#F1ECE3' },
  },
  student: {
    m: { top: '#E4DED3', topLo: '#CBC4B8', bottom: '#6F7E8E', hair: '#2E2C30', acc: '#6F7E8E' },
    f: { top: '#E4DED3', topLo: '#CBC4B8', bottom: '#7D6E80', hair: '#2E2C30', acc: '#B97A6F' },
  },
  hoodie: {
    m: { top: '#A5928A', topLo: '#8E7C75', bottom: '#6B6A70', hair: '#5A4A42', acc: '#8E7C75' },
    f: { top: '#C2A4A0', topLo: '#A88C88', bottom: '#6B6A70', hair: '#6A5040', acc: '#A88C88' },
  },
  headphone: {
    m: { top: '#8FA595', topLo: '#788E7F', bottom: '#5F6568', hair: '#6A5548', acc: '#C98BA0' },
    f: { top: '#D8C49A', topLo: '#BCA87E', bottom: '#5F6568', hair: '#3D3836', acc: '#7FA9A3' },
  },
  // 長者：灰髮、針織外套；acc 是阿公的鴨舌帽
  elder: {
    m: { top: '#8C9180', topLo: '#767B6B', bottom: '#5F6064', hair: '#BDB7B0', acc: '#6E6A64' },
    f: { top: '#9A8494', topLo: '#82707E', bottom: '#6E6A70', hair: '#C9C3BC', acc: '#9A8494' },
  },
  // 家長：acc 是牽著的小朋友的上衣
  parent: {
    m: { top: '#7F98A6', topLo: '#68808E', bottom: '#5E6470', hair: '#3D3836', acc: '#E3C27A' },
    f: { top: '#C49A8E', topLo: '#A9827A', bottom: '#5F6470', hair: '#4A3E3A', acc: '#E3C27A' },
  },
};

/** 夜間把衣著壓暗一階（之後改為 Palette Swap Shader） */
export function outfitFor(avatar: AvatarId, gender: Gender, mode: Mode): Outfit {
  const o = OUTFITS[avatar][gender];
  if (mode === 'morning') return o;
  const d = (c: string) => shade(c, 0.72);
  return { top: d(o.top), topLo: d(o.topLo), bottom: d(o.bottom), hair: d(o.hair), acc: d(o.acc) };
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export const hexToNum = (hex: string) => parseInt(hex.slice(1), 16);
