'use client';

import {
  COMPONENT_STATUSES,
  FONT_SOURCES,
  HEADER_STYLES,
  THEME_MODES,
  themeToCss,
  uploadUrl,
  type Palette,
  type Theme,
} from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '@/lib/client-api';
import { type ThemeState, type UploadInfo } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { PREVIEW_MESSAGE } from '../public/theme-preview-bridge';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Textarea, cx } from '../ui/ui';

const PALETTE_KEYS: (keyof Palette)[] = [
  'brand',
  'background',
  'surface',
  'text',
  'muted',
  'border',
  'link',
];
const IMAGE_FIELDS = ['logoId', 'logoDarkId', 'faviconId', 'headerImageId', 'ogImageId'] as const;

function expandHex(value: string): string {
  return /^#[0-9a-f]{3}$/i.test(value)
    ? `#${[...value.slice(1)].map((c) => c + c).join('')}`
    : value;
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={expandHex(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent"
        />
        <Input
          className="w-24 font-mono"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(e.target.value)) onChange(e.target.value);
          }}
        />
      </span>
    </label>
  );
}

function UploadField({
  label,
  hint,
  kind,
  value,
  uploads,
  pageId,
  onChange,
  onUploaded,
}: {
  label: string;
  hint?: string;
  kind: 'image' | 'font';
  value: string | null;
  uploads: UploadInfo[];
  pageId: string;
  onChange: (id: string | null) => void;
  onUploaded: (upload: UploadInfo) => void;
}) {
  const t = useTranslations('admin.appearance');
  const { run, pending, error } = useAction();
  const options = uploads.filter((u) => u.kind === kind);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'image' && value ? (
          <img
            src={uploadUrl(value)}
            alt=""
            className="h-10 w-auto max-w-32 rounded border border-[var(--border)] bg-[var(--background)] object-contain p-1"
          />
        ) : null}
        <Select
          className="w-auto max-w-56"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">{t('none')}</option>
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.filename}
            </option>
          ))}
        </Select>
        <label
          className={cx(
            'cursor-pointer rounded-md border border-[var(--border)] px-3 py-2 hover:bg-[var(--background)]',
            pending && 'opacity-50',
          )}
        >
          {pending ? t('uploading') : t('upload')}
          <input
            type="file"
            className="sr-only"
            disabled={pending}
            accept={
              kind === 'image'
                ? 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon'
                : '.woff2,.woff,.ttf,.otf'
            }
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const created = await run(() => uploadFile<UploadInfo>(pageId, file), {
                refresh: false,
              });
              if (created) {
                onUploaded(created);
                onChange(created.id);
              }
            }}
          />
        </label>
      </div>
      {hint ? <span className="text-xs text-[var(--muted)]">{hint}</span> : null}
      <ApiErrorAlert error={error} />
    </div>
  );
}

export function ThemeEditor({
  pageId,
  previewPath,
  initial,
  initialUploads,
}: {
  pageId: string;
  previewPath: string;
  initial: ThemeState;
  initialUploads: UploadInfo[];
}) {
  const t = useTranslations('admin.appearance');
  const tStatus = useTranslations('status');
  const [theme, setTheme] = useState<Theme>(initial.draft);
  const [saved, setSaved] = useState<Theme>(initial.draft);
  const [hasUnpublished, setHasUnpublished] = useState(initial.hasUnpublishedChanges);
  const [uploads, setUploads] = useState(initialUploads);
  const [removedCss, setRemovedCss] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const iframe = useRef<HTMLIFrameElement>(null);
  const { run, pending, error } = useAction();
  const dirty = JSON.stringify(theme) !== JSON.stringify(saved);

  const set = <K extends keyof Theme>(key: K, value: Theme[K]) =>
    setTheme((prev) => ({ ...prev, [key]: value }));

  // Pré-visualização ao vivo: cores, modo, fonte e CSS vão por postMessage.
  const sendPreview = useCallback(() => {
    iframe.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, css: `${themeToCss(theme)}\n${theme.customCss}` },
      window.location.origin,
    );
  }, [theme]);

  useEffect(() => {
    const timer = setTimeout(sendPreview, 150);
    return () => clearTimeout(timer);
  }, [sendPreview]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === `${PREVIEW_MESSAGE}-ready`
      )
        sendPreview();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendPreview]);

  const reloadPreview = () => iframe.current?.contentWindow?.location.reload();

  async function save(): Promise<boolean> {
    const result = await run(
      () =>
        api<{ theme: Theme; removedCss: string[] }>(`/pages/${pageId}/theme/draft`, {
          method: 'PUT',
          body: theme,
        }),
      { refresh: false },
    );
    if (!result) return false;
    setTheme(result.theme);
    setSaved(result.theme);
    setRemovedCss(result.removedCss);
    setHasUnpublished(true);
    reloadPreview();
    return true;
  }

  async function publish() {
    if (dirty && !(await save())) return;
    const state = await run(
      () => api<ThemeState>(`/pages/${pageId}/theme/publish`, { method: 'POST' }),
      { refresh: false },
    );
    if (state) {
      setHasUnpublished(false);
      setMessage(t('published'));
    }
  }

  async function discard() {
    if (!window.confirm(t('confirmDiscard'))) return;
    const state = await run(
      () => api<ThemeState>(`/pages/${pageId}/theme/discard`, { method: 'POST' }),
      { refresh: false },
    );
    if (state) {
      setTheme(state.draft);
      setSaved(state.draft);
      setHasUnpublished(false);
      setRemovedCss([]);
      reloadPreview();
    }
  }

  const uploadProps = {
    uploads,
    pageId,
    onUploaded: (u: UploadInfo) => setUploads((list) => [u, ...list]),
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_1fr]">
      <div className="flex flex-col gap-6">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <Button onClick={() => void save()} disabled={pending || !dirty} variant="secondary">
            {t('saveDraft')}
          </Button>
          <Button onClick={() => void publish()} disabled={pending || (!dirty && !hasUnpublished)}>
            {t('publish')}
          </Button>
          <Button
            onClick={() => void discard()}
            disabled={pending || (!dirty && !hasUnpublished)}
            variant="ghost"
          >
            {t('discard')}
          </Button>
          <span className="text-xs text-[var(--muted)]">
            {dirty ? t('unsaved') : hasUnpublished ? t('draftSaved') : t('upToDate')}
          </span>
        </div>
        <ApiErrorAlert error={error} />
        {message && !dirty && !hasUnpublished ? <Alert tone="info">{message}</Alert> : null}
        {removedCss.length > 0 ? (
          <Alert>
            {t('cssRemoved')}
            <ul className="mt-1 list-disc pl-5 font-mono text-xs">
              {removedCss.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <Card title={t('identity')}>
          <div className="flex flex-col gap-4">
            {IMAGE_FIELDS.map((field) => (
              <UploadField
                key={field}
                label={t(`images.${field}`)}
                hint={t(`imageHints.${field}`)}
                kind="image"
                value={theme[field]}
                onChange={(id) => set(field, id)}
                {...uploadProps}
              />
            ))}
          </div>
        </Card>

        <Card title={t('colors')}>
          <div className="flex flex-col gap-4">
            <Field label={t('mode')}>
              <Select
                value={theme.mode}
                onChange={(e) => set('mode', e.target.value as Theme['mode'])}
              >
                {THEME_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`modes.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {theme.mode !== 'dark' ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{t('lightPalette')}</legend>
                {PALETTE_KEYS.map((key) => (
                  <ColorInput
                    key={key}
                    label={t(`palette.${key}`)}
                    value={theme.colors[key]}
                    onChange={(v) => set('colors', { ...theme.colors, [key]: v })}
                  />
                ))}
              </fieldset>
            ) : null}
            {theme.mode !== 'light' ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{t('darkPalette')}</legend>
                {PALETTE_KEYS.map((key) => (
                  <ColorInput
                    key={key}
                    label={t(`palette.${key}`)}
                    value={theme.darkColors[key]}
                    onChange={(v) => set('darkColors', { ...theme.darkColors, [key]: v })}
                  />
                ))}
              </fieldset>
            ) : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t('statusColors')}</legend>
              {COMPONENT_STATUSES.map((s) => (
                <ColorInput
                  key={s}
                  label={tStatus(s)}
                  value={theme.statusColors[s]}
                  onChange={(v) => set('statusColors', { ...theme.statusColors, [s]: v })}
                />
              ))}
            </fieldset>
          </div>
        </Card>

        <Card title={t('typography')}>
          <div className="flex flex-col gap-4">
            <Field label={t('fontSource')}>
              <Select
                value={theme.font.source}
                onChange={(e) =>
                  set('font', { ...theme.font, source: e.target.value as Theme['font']['source'] })
                }
              >
                {FONT_SOURCES.map((f) => (
                  <option key={f} value={f}>
                    {t(`fonts.${f}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {theme.font.source !== 'system' ? (
              <Field
                label={t('fontFamily')}
                hint={theme.font.source === 'google' ? t('googleHint') : t('uploadFontHint')}
              >
                <Input
                  value={theme.font.family ?? ''}
                  maxLength={60}
                  onChange={(e) => set('font', { ...theme.font, family: e.target.value || null })}
                />
              </Field>
            ) : null}
            {theme.font.source === 'upload' ? (
              <UploadField
                label={t('fontFile')}
                kind="font"
                value={theme.font.uploadId}
                onChange={(id) => set('font', { ...theme.font, uploadId: id })}
                {...uploadProps}
              />
            ) : null}
          </div>
        </Card>

        <Card title={t('layout')}>
          <div className="flex flex-col gap-4">
            <Field label={t('header')}>
              <Select
                value={theme.header}
                onChange={(e) => set('header', e.target.value as Theme['header'])}
              >
                {HEADER_STYLES.map((h) => (
                  <option key={h} value={h}>
                    {t(`headers.${h}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox
              label={t('showPastIncidents')}
              checked={theme.showPastIncidents}
              onChange={(e) => set('showPastIncidents', e.target.checked)}
            />
          </div>
        </Card>

        <Card title={t('texts')}>
          <div className="flex flex-col gap-4">
            <Field label={t('footer')}>
              <Textarea
                className="min-h-16"
                maxLength={300}
                value={theme.texts.footer ?? ''}
                onChange={(e) => set('texts', { ...theme.texts, footer: e.target.value || null })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('supportUrl')}>
                <Input
                  value={theme.texts.supportUrl ?? ''}
                  placeholder="https://"
                  onChange={(e) =>
                    set('texts', { ...theme.texts, supportUrl: e.target.value || null })
                  }
                />
              </Field>
              <Field label={t('supportLabel')}>
                <Input
                  value={theme.texts.supportLabel ?? ''}
                  maxLength={60}
                  onChange={(e) =>
                    set('texts', { ...theme.texts, supportLabel: e.target.value || null })
                  }
                />
              </Field>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t('links')}</legend>
              {theme.links.map((link, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={t('linkLabel')}
                    placeholder={t('linkLabel')}
                    value={link.label}
                    maxLength={60}
                    onChange={(e) =>
                      set(
                        'links',
                        theme.links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)),
                      )
                    }
                  />
                  <Input
                    aria-label={t('linkUrl')}
                    placeholder="https://"
                    value={link.url}
                    onChange={(e) =>
                      set(
                        'links',
                        theme.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    aria-label={t('removeLink')}
                    onClick={() =>
                      set(
                        'links',
                        theme.links.filter((_, j) => j !== i),
                      )
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
              {theme.links.length < 8 ? (
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => set('links', [...theme.links, { label: '', url: '' }])}
                  >
                    + {t('addLink')}
                  </Button>
                </div>
              ) : null}
            </fieldset>
          </div>
        </Card>

        <Card title={t('advanced')}>
          <div className="flex flex-col gap-4">
            <Alert tone="info">{t('advancedHint')}</Alert>
            <Field label={t('customCss')}>
              <Textarea
                className="min-h-40 font-mono text-xs"
                spellCheck={false}
                value={theme.customCss}
                onChange={(e) => set('customCss', e.target.value)}
              />
            </Field>
            <Field label={t('customHeaderHtml')}>
              <Textarea
                className="font-mono text-xs"
                spellCheck={false}
                value={theme.customHeaderHtml}
                onChange={(e) => set('customHeaderHtml', e.target.value)}
              />
            </Field>
            <Field label={t('customFooterHtml')}>
              <Textarea
                className="font-mono text-xs"
                spellCheck={false}
                value={theme.customFooterHtml}
                onChange={(e) => set('customFooterHtml', e.target.value)}
              />
            </Field>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-2 xl:sticky xl:top-4 xl:self-start">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('preview')}</span>
          <div className="flex gap-1">
            {(['desktop', 'mobile'] as const).map((w) => (
              <Button
                key={w}
                variant={width === w ? 'secondary' : 'ghost'}
                onClick={() => setWidth(w)}
              >
                {t(`widths.${w}`)}
              </Button>
            ))}
            <Button variant="ghost" onClick={reloadPreview}>
              {t('reload')}
            </Button>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">{t('previewHint')}</p>
        <div className="flex justify-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
          <iframe
            ref={iframe}
            title={t('preview')}
            src={previewPath}
            className={cx(
              'h-[80vh] rounded bg-white',
              width === 'desktop' ? 'w-full' : 'w-[390px]',
            )}
          />
        </div>
      </div>
    </div>
  );
}
