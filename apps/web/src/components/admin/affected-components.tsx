'use client';

import { COMPONENT_STATUSES, type ComponentStatus } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { Checkbox, Select } from '../ui/ui';

export type Affected = Record<string, ComponentStatus>;

/** Seleção dos componentes afetados e do status de cada um. */
export function AffectedComponents({
  components,
  value,
  onChange,
}: {
  components: { id: string; name: string; status: ComponentStatus }[];
  value: Affected;
  onChange: (value: Affected) => void;
}) {
  const t = useTranslations();
  if (components.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t('admin.incidents.noComponents')}</p>;
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('admin.incidents.affected')}</legend>
      {components.map((c) => {
        const selected = c.id in value;
        return (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
            <Checkbox
              label={c.name}
              checked={selected}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.checked)
                  next[c.id] = c.status === 'operational' ? 'partial_outage' : c.status;
                else delete next[c.id];
                onChange(next);
              }}
            />
            {selected ? (
              <Select
                aria-label={t('admin.incidents.componentStatusFor', { name: c.name })}
                className="w-auto"
                value={value[c.id]}
                onChange={(e) => onChange({ ...value, [c.id]: e.target.value as ComponentStatus })}
              >
                {COMPONENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

export function toChanges(value: Affected) {
  return Object.entries(value).map(([componentId, status]) => ({ componentId, status }));
}
