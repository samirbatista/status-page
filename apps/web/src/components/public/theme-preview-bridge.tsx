'use client';

import { useEffect } from 'react';

export const PREVIEW_MESSAGE = 'sp-theme-preview';

/**
 * Na pré-visualização do editor de aparência, recebe o CSS do tema em edição
 * (via postMessage da mesma origem) e o aplica sem recarregar a página.
 */
export function ThemePreviewBridge() {
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'sp-theme-live';
    // No fim do body: vem depois do <style> do tema publicado e o sobrepõe.
    document.body.appendChild(style);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; css?: string } | null;
      // textContent: o CSS nunca é interpretado como HTML.
      if (data?.type === PREVIEW_MESSAGE && typeof data.css === 'string')
        style.textContent = data.css;
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: `${PREVIEW_MESSAGE}-ready` }, window.location.origin);
    return () => {
      window.removeEventListener('message', onMessage);
      style.remove();
    };
  }, []);
  return null;
}
