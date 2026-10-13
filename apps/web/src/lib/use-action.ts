'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

/**
 * Executa uma ação assíncrona com estado de carregamento/erro e atualiza os
 * dados da página. `pending` continua verdadeiro até o refresh terminar, para
 * que o formulário não aceite outra ação com dados desatualizados.
 */
export function useAction() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(
    async <T>(
      fn: () => Promise<T>,
      options: { refresh?: boolean } = {},
    ): Promise<T | undefined> => {
      setRunning(true);
      setError(null);
      try {
        const result = await fn();
        if (options.refresh !== false) startTransition(() => router.refresh());
        return result;
      } catch (e) {
        setError(e);
        return undefined;
      } finally {
        setRunning(false);
      }
    },
    [router],
  );

  return { run, pending: running || refreshing, error, setError };
}
