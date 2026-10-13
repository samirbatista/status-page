import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { type AuditContext, recordAudit } from '@status-page/core';
import { API_ENV, type ApiEnv } from '../env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { ThemeService } from '../theme/theme.service.js';
import { detectFileType, isUnsafeSvg } from './file-type.js';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const UPLOAD_SELECT = {
  id: true,
  kind: true,
  filename: true,
  contentType: true,
  size: true,
  createdAt: true,
} as const;

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly dir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly themes: ThemeService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.dir = resolve(env.UPLOAD_DIR);
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  list(pageId: string) {
    return this.prisma.client.upload.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      select: UPLOAD_SELECT,
    });
  }

  async create(
    pageId: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    audit: AuditContext,
  ) {
    if (!file) throw new BadRequestException({ message: 'file_required' });
    if (file.size > MAX_UPLOAD_BYTES)
      throw new PayloadTooLargeException({ message: 'file_too_large' });
    const type = detectFileType(file.buffer);
    if (!type) throw new BadRequestException({ message: 'unsupported_file_type' });
    if (type.contentType === 'image/svg+xml' && isUnsafeSvg(file.buffer)) {
      throw new BadRequestException({ message: 'unsafe_svg' });
    }

    const filename = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'arquivo';
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    // Grava em arquivo temporário e só publica (rename) depois do registro no banco.
    const temp = join(this.dir, `.tmp-${sha256}-${Date.now()}`);
    await writeFile(temp, file.buffer, { mode: 0o640 });
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const upload = await tx.upload.create({
          data: {
            pageId,
            kind: type.kind,
            filename,
            contentType: type.contentType,
            size: file.size,
            sha256,
            createdById: audit.actorId ?? null,
          },
          select: UPLOAD_SELECT,
        });
        await rename(temp, this.path(upload.id));
        await recordAudit(tx, {
          ...audit,
          action: 'upload.create',
          entityType: 'upload',
          entityId: upload.id,
          pageId,
          after: upload,
        });
        return upload;
      });
    } finally {
      await rm(temp, { force: true });
    }
  }

  async remove(pageId: string, uploadId: string, audit: AuditContext): Promise<void> {
    const upload = await this.prisma.client.upload.findFirst({ where: { id: uploadId, pageId } });
    if (!upload) throw new NotFoundException({ message: 'upload_not_found' });
    if ((await this.themes.referencedUploads(pageId)).has(uploadId)) {
      throw new ConflictException({ message: 'upload_in_use' });
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.upload.delete({ where: { id: uploadId } });
      await recordAudit(tx, {
        ...audit,
        action: 'upload.delete',
        entityType: 'upload',
        entityId: uploadId,
        pageId,
        before: upload,
      });
    });
    await rm(this.path(uploadId), { force: true });
  }

  /** Metadados + página dona, para a rota pública aplicar as regras de acesso. */
  async findForServing(uploadId: string) {
    const upload = await this.prisma.client.upload.findUnique({
      where: { id: uploadId },
      include: {
        page: { select: { id: true, visibility: true, privateAccess: true, allowedCidrs: true } },
      },
    });
    if (!upload) throw new NotFoundException({ message: 'upload_not_found' });
    return upload;
  }

  stream(uploadId: string) {
    return createReadStream(this.path(uploadId));
  }

  private path(uploadId: string): string {
    // O ID vem do banco (UUID), nunca do nome do arquivo enviado.
    return join(this.dir, uploadId);
  }
}
