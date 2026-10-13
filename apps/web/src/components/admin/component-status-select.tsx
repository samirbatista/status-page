'use client';

import { COMPONENT_STATUSES, type ComponentStatus } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/client-api';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Select } from '../ui/ui';

/** Troca manual do status de um componente (Operador ou superior). */
export function ComponentStatusSelect({
  pageId,
  componentId,
  name,
  status,
  disabled,
}: {
  pageId: string;
  componentId: string;
  name: string;
  status: ComponentStatus;
  disabled?: boolean;
}) {
  const t = useTranslations('status');
  const tIncidents = useTranslations('admin.incidents');
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <Select
        aria-label={tIncidents('componentStatusFor', { name })}
        className="w-auto"
        value={status}
        disabled={disabled || pending}
        onChange={(e) =>
          run(() =>
            api(`/pages/${pageId}/components/${componentId}/status`, {
              method: 'PUT',
              body: { status: e.target.value },
            }),
          )
        }
      >
        {COMPONENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(s)}
          </option>
        ))}
      </Select>
      <ApiErrorAlert error={error} />
    </div>
  );
}
