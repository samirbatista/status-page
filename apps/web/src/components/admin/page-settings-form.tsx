'use client';

import { LOCALES, PRIVATE_ACCESS_MODES, type PrivateAccessMode } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { type AdminPage } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Alert, Button, Field, Input, Select, Textarea } from '../ui/ui';

const LOCALE_LABELS: Record<string, string> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)',
  es: 'Español',
};

/** Criação (sem `page`) ou edição das configurações de uma página. */
export function PageSettingsForm({ page, isOwner }: { page?: AdminPage; isOwner: boolean }) {
  const t = useTranslations('admin.settings');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [visibility, setVisibility] = useState(page?.visibility ?? 'public');
  const [access, setAccess] = useState<PrivateAccessMode>(page?.privateAccess ?? 'login');
  const usesIp = access !== 'login';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get('name'),
      description: form.get('description'),
      timezone: form.get('timezone'),
      defaultLocale: form.get('defaultLocale'),
      visibility: form.get('visibility'),
    };
    if (page) {
      const cidrs = String(form.get('allowedCidrs') ?? '')
        .split(/[\s,]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      Object.assign(body, { privateAccess: access, allowedCidrs: cidrs });
      await run(() => api(`/pages/${page.id}`, { method: 'PATCH', body }));
    } else {
      const created = await run(
        () =>
          api<AdminPage>('/pages', { method: 'POST', body: { ...body, slug: form.get('slug') } }),
        { refresh: false },
      );
      if (created) {
        router.push(`/admin/pages/${created.id}/components`);
        router.refresh();
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label={t('name')}>
          <Input name="name" defaultValue={page?.name} required maxLength={120} />
        </Field>
        {page ? (
          <Field label={t('slug')} hint={t('slugFixed')}>
            <Input value={page.slug} disabled readOnly />
          </Field>
        ) : (
          <Field label={t('slug')} hint={t('slugHint')}>
            <Input
              name="slug"
              required
              pattern="[a-z0-9](?:[a-z0-9\-]{0,48}[a-z0-9])?"
              maxLength={50}
            />
          </Field>
        )}
        <Field label={t('description')}>
          <Input name="description" defaultValue={page?.description ?? ''} maxLength={500} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('timezone')} hint={t('timezoneHint')}>
            <Input
              name="timezone"
              defaultValue={page?.timezone ?? 'America/Sao_Paulo'}
              required
              maxLength={64}
            />
          </Field>
          <Field label={t('defaultLocale')}>
            <Select name="defaultLocale" defaultValue={page?.defaultLocale ?? 'pt-BR'}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('visibility')}>
            <Select
              name="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
            >
              <option value="public">{t('public')}</option>
              <option value="private">{t('private')}</option>
            </Select>
          </Field>
        </div>
        {page && visibility === 'private' ? (
          <fieldset className="flex flex-col gap-4 rounded-md border border-[var(--border)] p-4">
            <legend className="px-1 text-sm font-medium">{t('privateAccess')}</legend>
            <Field label={t('accessMode')}>
              <Select
                value={access}
                onChange={(e) => setAccess(e.target.value as PrivateAccessMode)}
              >
                {PRIVATE_ACCESS_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`accessModes.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {usesIp ? (
              <Field label={t('allowedCidrs')} hint={t('allowedCidrsHint')}>
                <Textarea
                  name="allowedCidrs"
                  className="min-h-20 font-mono text-xs"
                  defaultValue={page.allowedCidrs.join('\n')}
                  placeholder={'10.0.0.0/8\n192.168.0.0/16'}
                />
              </Field>
            ) : (
              <input type="hidden" name="allowedCidrs" value={page.allowedCidrs.join('\n')} />
            )}
          </fieldset>
        ) : null}
        <ApiErrorAlert error={error} />
        <div>
          <Button type="submit" disabled={pending}>
            {page ? tAdmin('save') : t('create')}
          </Button>
        </div>
      </form>

      {page && isOwner ? (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
          {page.isDefault ? (
            <Alert tone="info">{t('isDefault')}</Alert>
          ) : (
            <div>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => api(`/pages/${page.id}/default`, { method: 'PUT' }))}
              >
                {t('makeDefault')}
              </Button>
            </div>
          )}
          <div>
            <Button
              variant="danger"
              disabled={pending}
              onClick={async () => {
                if (window.prompt(t('confirmDelete', { slug: page.slug })) !== page.slug) return;
                const ok = await run(
                  () => api(`/pages/${page.id}`, { method: 'DELETE' }).then(() => true),
                  {
                    refresh: false,
                  },
                );
                if (ok) {
                  router.push('/admin');
                  router.refresh();
                }
              }}
            >
              {t('delete')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
