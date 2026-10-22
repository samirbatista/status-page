import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { type AuditContext } from '@status-page/core';
import { type z } from 'zod';
import { RequireOwner, RequirePageRole, SessionOnly } from '../common/decorators.js';
import { Audit } from '../common/request-meta.js';
import { ZodBody } from '../common/zod.pipe.js';
import { ConfigExportService } from './config-export.service.js';
import { ConfigImportService } from './config-import.service.js';
import { exportRequestSchema, importOptionsSchema } from './format.js';

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

/** Exportar e importar a configuração da instalação (Dono, pelo painel). */
@SessionOnly()
@Controller()
export class ConfigTransferController {
  constructor(
    private readonly exporter: ConfigExportService,
    private readonly importer: ConfigImportService,
  ) {}

  @Post('admin/config/export')
  @RequireOwner()
  @HttpCode(200)
  async export(
    @ZodBody(exportRequestSchema) body: z.infer<typeof exportRequestSchema>,
    @Audit() audit: AuditContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.exporter.export(body, audit);
    res.set('Content-Disposition', `attachment; filename="status-page-config-${stamp()}.json"`);
    res.set('Cache-Control', 'no-store');
    return file;
  }

  /** Multipart: `file` (JSON exportado), `mode`, `password`, `dryRun`. */
  @Post('admin/config/import')
  @RequireOwner()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  async import(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() fields: Record<string, unknown>,
    @Audit() audit: AuditContext,
  ) {
    if (!file) throw new BadRequestException({ message: 'file_required' });
    const options = importOptionsSchema.safeParse(fields ?? {});
    if (!options.success) throw new BadRequestException({ message: 'validation_failed' });
    const config = this.importer.parse(file.buffer);
    return this.importer.import(config, options.data, audit);
  }

  /** Histórico de incidentes e manutenções da página (exportação separada). */
  @Get('pages/:pageId/export/history')
  @RequirePageRole('admin')
  async history(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.exporter.history(pageId);
    res.set(
      'Content-Disposition',
      `attachment; filename="status-page-${data.page.slug}-historico-${stamp()}.json"`,
    );
    return data;
  }
}
