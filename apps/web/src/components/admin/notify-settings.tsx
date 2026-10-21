'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Alert, Button, Card, Checkbox, Field, Input, Select } from '../ui/ui';

export interface NotifySettings {
  smtp: {
    enabled: boolean;
    host: string;
    port: number;
    security: 'none' | 'starttls' | 'tls';
    verifyCertificate: boolean;
    username: string;
    from: string;
    hasPassword: boolean;
  } | null;
  telegram: { enabled: boolean; botUsername: string | null; hasToken: boolean } | null;
  whatsapp: {
    enabled: boolean;
    phoneNumberId: string;
    notificationTemplate: string;
    authTemplate: string;
    templateLanguage: string;
    hasToken: boolean;
  } | null;
}

function useSaved() {
  const [saved, setSaved] = useState(false);
  return { saved, setSaved };
}

export function SmtpForm({ settings }: { settings: NotifySettings['smtp'] }) {
  const t = useTranslations('admin.notifySettings');
  const { run, pending, error } = useAction();
  const test = useAction();
  const { saved, setSaved } = useSaved();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  return (
    <Card title={t('smtpHeading')}>
      <form
        method="post"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          const f = new FormData(event.currentTarget);
          const ok = await run(() =>
            api('/notifications/settings/smtp', {
              method: 'PUT',
              body: {
                enabled: f.get('enabled') === 'on',
                host: f.get('host'),
                port: Number(f.get('port')),
                security: f.get('security'),
                verifyCertificate: f.get('verifyCertificate') === 'on',
                username: f.get('username'),
                password: f.get('password') || undefined,
                from: f.get('from'),
              },
            }).then(() => true),
          );
          if (ok) setSaved(true);
        }}
      >
        <Field label={t('host')}>
          <Input
            name="host"
            required
            defaultValue={settings?.host ?? ''}
            placeholder="smtp.empresa.com.br"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('security')}>
            <Select name="security" defaultValue={settings?.security ?? 'starttls'}>
              <option value="starttls">STARTTLS</option>
              <option value="tls">TLS</option>
              <option value="none">{t('noTls')}</option>
            </Select>
          </Field>
          <Field label={t('port')}>
            <Input name="port" type="number" required defaultValue={settings?.port ?? 587} />
          </Field>
        </div>
        <Field label={t('username')}>
          <Input name="username" defaultValue={settings?.username ?? ''} autoComplete="off" />
        </Field>
        <Field label={t('password')} hint={settings?.hasPassword ? t('keepSecret') : undefined}>
          <Input name="password" type="password" autoComplete="new-password" />
        </Field>
        <Field label={t('from')} hint={t('fromHint')} className="sm:col-span-2">
          <Input
            name="from"
            required
            defaultValue={settings?.from ?? ''}
            placeholder="Status <status@empresa.com.br>"
          />
        </Field>
        <Checkbox
          name="verifyCertificate"
          label={t('verifyCertificate')}
          defaultChecked={settings?.verifyCertificate ?? true}
        />
        <Checkbox name="enabled" label={t('enabled')} defaultChecked={settings?.enabled ?? true} />
        <div className="sm:col-span-2">
          <ApiErrorAlert error={error ?? test.error} />
          {saved ? <Alert tone="info">{t('saved')}</Alert> : null}
          {result ? (
            result.ok ? (
              <Alert tone="info">{t('testOk')}</Alert>
            ) : (
              <Alert>{`${t('testFailed')}: ${result.error}`}</Alert>
            )
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {t('save')}
          </Button>
          <Input
            name="testTo"
            type="email"
            placeholder={t('testTo')}
            className="w-64"
            aria-label={t('testTo')}
          />
          <Button
            variant="secondary"
            disabled={test.pending}
            onClick={async (event) => {
              const to = (
                event.currentTarget.form?.elements.namedItem('testTo') as HTMLInputElement
              ).value;
              setResult(null);
              const res = await test.run(
                () =>
                  api<{ ok: boolean; error?: string }>('/notifications/settings/smtp/test', {
                    method: 'POST',
                    body: { to },
                  }),
                { refresh: false },
              );
              if (res) setResult(res);
            }}
          >
            {t('sendTest')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function TelegramForm({ settings }: { settings: NotifySettings['telegram'] }) {
  const t = useTranslations('admin.notifySettings');
  const { run, pending, error } = useAction();
  const { saved, setSaved } = useSaved();
  return (
    <Card title={t('telegramHeading')}>
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          const f = new FormData(event.currentTarget);
          const ok = await run(() =>
            api('/notifications/settings/telegram', {
              method: 'PUT',
              body: {
                enabled: f.get('enabled') === 'on',
                botToken: f.get('botToken') || undefined,
              },
            }).then(() => true),
          );
          if (ok) setSaved(true);
        }}
      >
        <p className="text-sm text-[var(--muted)]">{t('telegramHint')}</p>
        {settings?.botUsername ? <p className="text-sm">@{settings.botUsername}</p> : null}
        <Field
          label={t('botToken')}
          hint={settings?.hasToken ? t('keepSecret') : t('botTokenHint')}
        >
          <Input name="botToken" autoComplete="off" placeholder="123456789:AA..." />
        </Field>
        <Checkbox name="enabled" label={t('enabled')} defaultChecked={settings?.enabled ?? true} />
        <ApiErrorAlert error={error} />
        {saved ? <Alert tone="info">{t('saved')}</Alert> : null}
        <div>
          <Button type="submit" disabled={pending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function WhatsappForm({ settings }: { settings: NotifySettings['whatsapp'] }) {
  const t = useTranslations('admin.notifySettings');
  const { run, pending, error } = useAction();
  const test = useAction();
  const { saved, setSaved } = useSaved();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  return (
    <Card title={t('whatsappHeading')}>
      <form
        method="post"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          const f = new FormData(event.currentTarget);
          const ok = await run(() =>
            api('/notifications/settings/whatsapp', {
              method: 'PUT',
              body: {
                enabled: f.get('enabled') === 'on',
                phoneNumberId: f.get('phoneNumberId'),
                accessToken: f.get('accessToken') || undefined,
                notificationTemplate: f.get('notificationTemplate'),
                authTemplate: f.get('authTemplate'),
                templateLanguage: f.get('templateLanguage'),
              },
            }).then(() => true),
          );
          if (ok) setSaved(true);
        }}
      >
        <p className="text-sm text-[var(--muted)] sm:col-span-2">{t('whatsappHint')}</p>
        <Field label={t('phoneNumberId')}>
          <Input name="phoneNumberId" required defaultValue={settings?.phoneNumberId ?? ''} />
        </Field>
        <Field label={t('accessToken')} hint={settings?.hasToken ? t('keepSecret') : undefined}>
          <Input name="accessToken" type="password" autoComplete="off" />
        </Field>
        <Field label={t('notificationTemplate')} hint={t('notificationTemplateHint')}>
          <Input
            name="notificationTemplate"
            required
            defaultValue={settings?.notificationTemplate ?? 'status_update'}
          />
        </Field>
        <Field label={t('authTemplate')} hint={t('authTemplateHint')}>
          <Input
            name="authTemplate"
            required
            defaultValue={settings?.authTemplate ?? 'status_code'}
          />
        </Field>
        <Field label={t('templateLanguage')}>
          <Input
            name="templateLanguage"
            required
            defaultValue={settings?.templateLanguage ?? 'pt_BR'}
          />
        </Field>
        <div className="flex items-end">
          <Checkbox
            name="enabled"
            label={t('enabled')}
            defaultChecked={settings?.enabled ?? true}
          />
        </div>
        <div className="sm:col-span-2">
          <ApiErrorAlert error={error ?? test.error} />
          {saved ? <Alert tone="info">{t('saved')}</Alert> : null}
          {result ? (
            result.ok ? (
              <Alert tone="info">{t('testOk')}</Alert>
            ) : (
              <Alert>{`${t('testFailed')}: ${result.error}`}</Alert>
            )
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {t('save')}
          </Button>
          <Input
            name="testPhone"
            type="tel"
            placeholder="+5511999990000"
            className="w-48"
            aria-label={t('testPhone')}
          />
          <Button
            variant="secondary"
            disabled={test.pending}
            onClick={async (event) => {
              const phone = (
                event.currentTarget.form?.elements.namedItem('testPhone') as HTMLInputElement
              ).value;
              setResult(null);
              const res = await test.run(
                () =>
                  api<{ ok: boolean; error?: string }>('/notifications/settings/whatsapp/test', {
                    method: 'POST',
                    body: { phone },
                  }),
                { refresh: false },
              );
              if (res) setResult(res);
            }}
          >
            {t('sendTest')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
