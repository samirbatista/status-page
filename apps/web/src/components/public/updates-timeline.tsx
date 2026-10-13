import { type IncidentStatus, type MaintenanceStatus } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { LocalTime } from '../local-time';

interface TimelineItem {
  id: string;
  label: string;
  body: string;
  at: string;
  components?: string[];
}

export function Timeline({ items, timeZone }: { items: TimelineItem[]; timeZone: string }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((item) => (
        <li key={item.id} className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:gap-4">
          <span className="font-semibold">{item.label}</span>
          <div className="flex flex-col gap-1">
            {item.body ? <p className="whitespace-pre-line">{item.body}</p> : null}
            <p className="text-xs text-[var(--muted)]">
              <LocalTime value={item.at} fallbackTimeZone={timeZone} />
              {item.components && item.components.length > 0
                ? ` · ${item.components.join(', ')}`
                : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function useIncidentTimeline(
  updates: {
    id: string;
    status: IncidentStatus;
    body: string;
    displayAt: string;
    components: { component: { name: string } }[];
  }[],
) {
  const t = useTranslations('incident');
  return updates.map((u) => ({
    id: u.id,
    label: t(u.status),
    body: u.body,
    at: u.displayAt,
    components: u.components.map((c) => c.component.name),
  }));
}

export function useMaintenanceTimeline(
  updates: { id: string; status: MaintenanceStatus; body: string; createdAt: string }[],
) {
  const t = useTranslations('maintenance');
  return updates.map((u) => ({
    id: u.id,
    label: t(`status.${u.status}`),
    // Transições automáticas não têm texto: usa a mensagem padrão traduzida.
    body: u.body || t(`defaultBody.${u.status}`),
    at: u.createdAt,
  }));
}
