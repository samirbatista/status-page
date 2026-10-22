'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Avisa a página que incorporou o widget sobre a altura do conteúdo (iframe sem barra de rolagem). */
export function EmbedHeight({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.parent === window) return;
    const send = () =>
      window.parent.postMessage(
        { type: 'status-page:height', height: Math.ceil(el.getBoundingClientRect().height) },
        '*',
      );
    send();
    const observer = new ResizeObserver(send);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref}>{children}</div>;
}
