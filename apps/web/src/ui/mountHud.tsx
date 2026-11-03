import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Hud } from './Hud';

export function mountHud(host: HTMLElement) {
  createRoot(host).render(
    <StrictMode>
      <Hud />
    </StrictMode>,
  );
}
