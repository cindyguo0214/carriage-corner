// 頭上的名字：用 DOM 疊在畫布上，中文字在任何倍率下都清楚（docs/PRD.md §6.2）
import type { Label } from './actor';

export class NameLabels {
  private layer = document.createElement('div');
  private nodes = new Map<string, { el: HTMLSpanElement; key: string }>();

  constructor(host: HTMLElement) {
    this.layer.className = 'name-labels';
    this.layer.setAttribute('aria-hidden', 'true');
    host.appendChild(this.layer);
  }

  /** labels 已換算成 CSS px；只在數值變動時寫入 DOM */
  render(labels: (Label & { sx: number; sy: number })[]) {
    const seen = new Set<string>();
    for (const l of labels) {
      if (l.alpha < 0.05) continue;
      seen.add(l.id);
      let node = this.nodes.get(l.id);
      if (!node) {
        const el = document.createElement('span');
        el.className = 'name-label';
        this.layer.appendChild(el);
        node = { el, key: '' };
        this.nodes.set(l.id, node);
      }
      if (node.el.textContent !== l.name) node.el.textContent = l.name;
      node.el.classList.toggle('name-label--self', l.self);
      node.el.classList.toggle('gangway-sign', !!l.sign);
      if (l.sign) {
        node.el.onclick = l.sign.action;
        node.el.style.setProperty('--nudge', l.sign.align === 'left' ? '-4px' : '4px');
      }
      // 名字：錨點在頭頂正中；指示牌：錨點在通道門內側邊緣
      const anchor = !l.sign ? 'translate(-50%, -100%)' : l.sign.align === 'left' ? 'translate(0, -50%)' : 'translate(-100%, -50%)';
      const opacity = Math.round(l.alpha * 4) / 4;
      const key = `${Math.round(l.sx)},${Math.round(l.sy)},${opacity},${anchor}`;
      if (key !== node.key) {
        node.key = key;
        node.el.style.transform = `translate(${Math.round(l.sx)}px, ${Math.round(l.sy)}px) ${anchor}`;
        node.el.style.opacity = String(opacity);
      }
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.el.remove();
      this.nodes.delete(id);
    }
  }
}
