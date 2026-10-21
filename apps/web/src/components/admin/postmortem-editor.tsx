'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { type Postmortem } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { Button, Checkbox, Textarea } from '../ui/ui';

/** Postmortem em Markdown: rascunho, pré-visualização e publicação na página pública. */
export function PostmortemEditor({
  pageId,
  incidentId,
  postmortem,
  canEdit,
}: {
  pageId: string;
  incidentId: string;
  postmortem: Postmortem | null;
  canEdit: boolean;
}) {
  const t = useTranslations('admin.postmortem');
  const { run, pending, error } = useAction();
  const [body, setBody] = useState(postmortem?.body ?? '');
  const [preview, setPreview] = useState(false);
  const [notify, setNotify] = useState(true);
  const base = `/pages/${pageId}/incidents/${incidentId}/postmortem`;
  const dirty = body !== (postmortem?.body ?? '');
  const published = Boolean(postmortem?.publishedAt);

  if (!canEdit) {
    return postmortem ? (
      // HTML gerado e sanitizado pela API.
      <div className="postmortem" dangerouslySetInnerHTML={{ __html: postmortem.html }} />
    ) : (
      <p className="text-sm text-[var(--muted)]">{t('none')}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)]">
        {published ? (
          <>
            {t('publishedAt')} <LocalTime value={postmortem!.publishedAt!} />
          </>
        ) : (
          t('draftHint')
        )}
      </p>
      <div className="flex gap-1 text-sm">
        <Button variant={preview ? 'ghost' : 'secondary'} onClick={() => setPreview(false)}>
          {t('write')}
        </Button>
        <Button
          variant={preview ? 'secondary' : 'ghost'}
          disabled={!postmortem || dirty}
          title={dirty ? t('saveToPreview') : undefined}
          onClick={() => setPreview(true)}
        >
          {t('preview')}
        </Button>
      </div>
      {preview && postmortem ? (
        <div
          className="postmortem rounded-md border border-[var(--border)] p-3"
          dangerouslySetInnerHTML={{ __html: postmortem.html }}
        />
      ) : (
        <Textarea
          aria-label={t('body')}
          className="min-h-64 font-mono"
          value={body}
          maxLength={100_000}
          placeholder={t('placeholder')}
          onChange={(e) => setBody(e.target.value)}
        />
      )}
      <ApiErrorAlert error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={pending || !dirty}
          onClick={() => run(() => api(base, { method: 'PUT', body: { body } }))}
        >
          {t('save')}
        </Button>
        {published ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => api(`${base}/unpublish`, { method: 'POST' }))}
          >
            {t('unpublish')}
          </Button>
        ) : (
          <>
            <Button
              disabled={pending || !body.trim()}
              onClick={() =>
                run(async () => {
                  if (dirty) await api(base, { method: 'PUT', body: { body } });
                  await api(`${base}/publish`, { method: 'POST', body: { notify } });
                })
              }
            >
              {t('publish')}
            </Button>
            <Checkbox
              label={t('notify')}
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
          </>
        )}
      </div>
    </div>
  );
}
