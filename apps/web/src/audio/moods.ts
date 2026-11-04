// 聽音樂時的四種情境音樂（docs/PRD.md 第 22 章）。曲目來自 YouTube 音效庫，檔案放在 assets/music/。
import brightUrl from '../assets/music/bright-maple-leaf-rag.mp3';
import calmUrl from '../assets/music/calm-kiss-the-sky.mp3';
import romanticUrl from '../assets/music/romantic-one-step-closer.mp3';
import somberUrl from '../assets/music/somber-in-my-dreams.mp3';

export type Mood = 'calm' | 'bright' | 'romantic' | 'somber';

export interface MoodTrack {
  id: Mood;
  icon: string;
  zh: string;
  en: string;
  /** 適合什麼時候聽 */
  hint: string;
  title: string;
  artist: string;
  url: string;
}

export const MOODS: MoodTrack[] = [
  { id: 'calm', icon: '🌱', zh: '平靜', en: 'Calm', hint: '專注、讀書、寫程式', title: 'Kiss the Sky', artist: 'Aakash Gandhi', url: calmUrl },
  { id: 'bright', icon: '☕', zh: '輕快', en: 'Bright', hint: '開工準備、晨間通勤', title: 'Maple Leaf Rag', artist: "E's Jammy Jams", url: brightUrl },
  { id: 'romantic', icon: '🌙', zh: '浪漫', en: 'Romantic', hint: '夕陽、夜間放空', title: 'One Step Closer', artist: 'Aakash Gandhi', url: romanticUrl },
  { id: 'somber', icon: '🌧️', zh: '悲傷', en: 'Somber', hint: '低落、睡不著的時候', title: 'No.6 In My Dreams', artist: 'Esther Abrami', url: somberUrl },
];

export const moodOf = (id: Mood) => MOODS.find(m => m.id === id)!;
