// 場景介面：月台與車廂輪流掛在同一條像素渲染管線上（docs/PRD.md §6.4）
import type { Container } from 'pixi.js';
import type { Mode } from '@cc/shared';
import type { Label } from './actor';
import type { CharacterFrames } from './characters';

export interface Scene {
  readonly kind: 'platform' | 'carriage';
  /** 畫進 640×360 RenderTexture 的內容 */
  readonly world: Container;
  /** 以螢幕解析度畫在最上層的內容（world 座標，例如車窗上的字） */
  readonly overlay?: Container;
  /** 每個 world px 對應幾個裝置像素：overlay 的文字以此解析度光柵化 */
  setPixelScale?(scale: number): void;
  update(dt: number, now: number): void;
  /** world 座標的點擊；client 為 CSS px，用來定位 DOM 選單 */
  tap(x: number, y: number, client: { x: number; y: number }): void;
  /** 直式畫面時鏡頭想對準的 x */
  focusX(): number;
  labels(out: Label[]): void;
  setMode(mode: Mode, chars: CharacterFrames): void;
  /** 直式畫布上下延伸的顏色，以及背景色 */
  colors(mode: Mode): { top: string; edge: string; bottom: string; background: string };
  dispose(): void;
}
