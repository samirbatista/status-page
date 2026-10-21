import { getTranslations } from 'next-intl/server';
import { IncidentEditForm, IncidentUpdateForm } from '@/components/admin/incident-actions';
import { PostmortemEditor } from '@/components/admin/postmortem-editor';
import { LocalTime } from '@/components/local-time';
import { IncidentStatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/ui';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminIncident, type Postmortem, type Structure } from '@/lib/types';

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string; incidentId: string }>;
}) {
  const { locale, pageId, incidentId } = await params;
  const role = pageRole(await getMe(locale), pageId);
  const [incident, structure, { postmortem }] = await Promise.all([
    adminApi<AdminIncident>(`/pages/${pageId}/incidents/${incidentId}`, locale),
    adminApi<Structure>(`/pages/${pageId}/structure`, locale),
    adminApi<{ postmortem: Postmortem | null }>(
      `/pages/${pageId}/incidents/${incidentId}/postmortem`,
      locale,
    ),
  ]);
  const t = await getTranslations();
  const affectedIds = [
    ...new Set(incident.updates.flatMap((u) => u.components.map((c) => c.component.id))),
  ];
  const isOperator = can(role, 'operator');

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{incident.title}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
            <IncidentStatusBadge status={incident.status} />
            {t(`incident.impact.${incident.impact}`)} · <LocalTime value={incident.startedAt} />
            {incident.backfilled ? ` · ${t('admin.incidents.backfilled')}` : null}
          </p>
        </header>
        <Card title={t('admin.incidents.timeline')}>
          <ol className="flex flex-col gap-4">
            {incident.updates.map((u) => (
              <li key={u.id} className="flex flex-col gap-1 border-l-2 border-[var(--border)] pl-3">
                <span className="text-sm font-semibold">{t(`incident.${u.status}`)}</span>
                <p className="whitespace-pre-line text-sm">{u.body}</p>
                <p className="text-xs text-[var(--muted)]">
                  <LocalTime value={u.displayAt} />
                  {u.createdBy ? ` · ${u.createdBy.name}` : null}
                  {u.components.length > 0
                    ? ` · ${u.components.map((c) => `${c.component.name}: ${t(`status.${c.status}`)}`).join(', ')}`
                    : null}
                </p>
              </li>
            ))}
          </ol>
        </Card>
        {isOperator ? (
          <Card title={t('admin.incidents.postUpdate')}>
            <IncidentUpdateForm
              pageId={pageId}
              incidentId={incidentId}
              currentStatus={incident.status}
              components={structure.components}
              affectedIds={affectedIds}
            />
          </Card>
        ) : null}
        {isOperator || postmortem?.publishedAt ? (
          <Card title={t('admin.postmortem.heading')}>
            <PostmortemEditor
              pageId={pageId}
              incidentId={incidentId}
              postmortem={postmortem}
              canEdit={isOperator}
            />
          </Card>
        ) : null}
      </div>
      {isOperator ? (
        <Card title={t('admin.incidents.details')}>
          <IncidentEditForm
            pageId={pageId}
            incidentId={incidentId}
            title={incident.title}
            impact={incident.impact}
            canDelete={can(role, 'admin')}
          />
        </Card>
      ) : null}
    </div>
  );
}
