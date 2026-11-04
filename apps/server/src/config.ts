import { randomBytes } from 'node:crypto';

const production = process.argv.includes('--production') || process.env.CC_ENV === 'production';
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export interface Config {
  port: number;
  webOrigin: string | string[];
  /** 每段行駛秒數範圍：正式 5～10 分鐘（docs/PRD.md §4.7），開發時縮短 */
  runSec: [number, number];
  dwellSec: number;
  /** 月台上願意等現有列車的最長秒數；更久就從這站加開一班（docs/PRD.md 第 19 章） */
  platformWaitSec: number;
  /** 加開列車距離進站的秒數範圍 */
  platformLeadSec: [number, number];
  /** 斷線後保留座位的秒數；超過後於下一站下車 */
  graceSec: number;
  noteTtlSec: number;
  /** 新車廂的 NPC 熱度目標（含真人） */
  npcWarmth: number;
  tokenSecret: string;
}

export const config: Config = {
  // 不讀通用的 PORT：開發時它常被前端工具占用
  port: num('REALTIME_PORT', 5189),
  webOrigin: process.env.WEB_ORIGIN?.split(',') ?? ['http://127.0.0.1:5188', 'http://localhost:5188'],
  runSec: production ? [300, 600] : [num('RUN_MIN_SEC', 45), num('RUN_MAX_SEC', 70)],
  dwellSec: num('DWELL_SEC', production ? 20 : 14),
  platformWaitSec: num('PLATFORM_WAIT_SEC', 60),
  platformLeadSec: [10, 16],
  graceSec: num('GRACE_SEC', 60),
  noteTtlSec: num('NOTE_TTL_SEC', 8 * 60),
  npcWarmth: 4,
  // 正式環境必須以環境變數提供；未提供時每次啟動隨機產生（重啟後舊的 resumeToken 失效）
  tokenSecret: process.env.TOKEN_SECRET ?? randomBytes(32).toString('hex'),
};
