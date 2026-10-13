import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type AuditContext,
  InvalidCssError,
  recordAudit,
  sanitizeCss,
  sanitizeHtml,
} from '@status-page/core';
import { type Prisma } from '@status-page/db';
import { DEFAULT_THEME, parseTheme, type Theme } from '@status-page/shared';
import { PrismaService } from '../infra/prisma.service.js';

const IMAGE_FIELDS = ['logoId', 'logoDarkId', 'faviconId', 'headerImageId', 'ogImageId'] as const;

@Injectable()
export class ThemeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(pageId: string) {
    const rows = await this.prisma.client.pageTheme.findMany({ where: { pageId } });
    const published = rows.find((r) => r.kind === 'published');
    const draft = rows.find((r) => r.kind === 'draft');
    const publishedTheme = published ? parseTheme(published.data) : DEFAULT_THEME;
    const draftTheme = draft ? parseTheme(draft.data) : publishedTheme;
    return {
      draft: draftTheme,
      published: publishedTheme,
      hasUnpublishedChanges: JSON.stringify(draftTheme) !== JSON.stringify(publishedTheme),
      publishedAt: published?.updatedAt ?? null,
    };
  }

  /** Tema publicado (ou o rascunho, para pré-visualização). */
  async forDisplay(pageId: string, kind: 'published' | 'draft' = 'published'): Promise<Theme> {
    const themes = await this.get(pageId);
    return kind === 'draft' ? themes.draft : themes.published;
  }

  /** Valida referências a arquivos, sanitiza CSS/HTML e grava o rascunho. */
  async saveDraft(pageId: string, input: Theme, audit: AuditContext) {
    await this.assertUploads(pageId, input);

    let css;
    try {
      css = sanitizeCss(input.customCss);
    } catch (error) {
      if (error instanceof InvalidCssError) {
        throw new BadRequestException({ message: 'invalid_css', reason: error.reason });
      }
      throw error;
    }
    const theme: Theme = {
      ...input,
      customCss: css.css,
      customHeaderHtml: sanitizeHtml(input.customHeaderHtml),
      customFooterHtml: sanitizeHtml(input.customFooterHtml),
    };

    await this.prisma.client.$transaction(async (tx) => {
      await this.write(tx, pageId, 'draft', theme, audit.actorId);
      await recordAudit(tx, {
        ...audit,
        action: 'theme.save_draft',
        entityType: 'page',
        entityId: pageId,
        pageId,
        after: { removedCss: css.removed },
      });
    });
    return { theme, removedCss: css.removed };
  }

  async publish(pageId: string, audit: AuditContext) {
    const { draft, published } = await this.get(pageId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.write(tx, pageId, 'published', draft, audit.actorId);
      await this.write(tx, pageId, 'draft', draft, audit.actorId);
      await recordAudit(tx, {
        ...audit,
        action: 'theme.publish',
        entityType: 'page',
        entityId: pageId,
        pageId,
        before: published,
        after: draft,
      });
    });
    return this.get(pageId);
  }

  async discardDraft(pageId: string, audit: AuditContext) {
    const { published } = await this.get(pageId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.write(tx, pageId, 'draft', published, audit.actorId);
      await recordAudit(tx, {
        ...audit,
        action: 'theme.discard_draft',
        entityType: 'page',
        entityId: pageId,
        pageId,
      });
    });
    return this.get(pageId);
  }

  /** IDs de arquivos usados pelo rascunho ou pelo tema publicado. */
  async referencedUploads(pageId: string): Promise<Set<string>> {
    const { draft, published } = await this.get(pageId);
    const ids = new Set<string>();
    for (const theme of [draft, published]) {
      for (const field of IMAGE_FIELDS) if (theme[field]) ids.add(theme[field]!);
      if (theme.font.uploadId) ids.add(theme.font.uploadId);
      for (const m of `${theme.customCss}${theme.customHeaderHtml}${theme.customFooterHtml}`.matchAll(
        /\/api\/public\/uploads\/([0-9a-f-]{36})/gi,
      )) {
        ids.add(m[1]!.toLowerCase());
      }
    }
    return ids;
  }

  private async assertUploads(pageId: string, theme: Theme): Promise<void> {
    const images = IMAGE_FIELDS.map((f) => theme[f]).filter((v): v is string => Boolean(v));
    const fonts = theme.font.uploadId ? [theme.font.uploadId] : [];
    const found = await this.prisma.client.upload.findMany({
      where: { pageId, id: { in: [...images, ...fonts] } },
      select: { id: true, kind: true },
    });
    const kind = new Map(found.map((u) => [u.id, u.kind]));
    const wrong = [
      ...images.filter((id) => kind.get(id) !== 'image'),
      ...fonts.filter((id) => kind.get(id) !== 'font'),
    ];
    if (wrong.length > 0)
      throw new BadRequestException({ message: 'invalid_upload', invalid: wrong });
    if (theme.font.source === 'upload' && !theme.font.uploadId) {
      throw new BadRequestException({ message: 'invalid_upload', invalid: ['font'] });
    }
  }

  private async write(
    tx: Prisma.TransactionClient,
    pageId: string,
    kind: 'draft' | 'published',
    theme: Theme,
    actorId: string | null | undefined,
  ) {
    const data = theme as unknown as Prisma.InputJsonValue;
    await tx.pageTheme.upsert({
      where: { pageId_kind: { pageId, kind } },
      create: { pageId, kind, data, updatedById: actorId ?? null },
      update: { data, updatedById: actorId ?? null },
    });
  }
}
