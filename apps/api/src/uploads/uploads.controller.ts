import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { type AuditContext } from '@status-page/core';
import { assertCanView } from '../access/page-access.js';
import { type AuthContext } from '../common/auth.types.js';
import { Public, RequirePageRole } from '../common/decorators.js';
import { Audit, CurrentAuth } from '../common/request-meta.js';
import { MAX_UPLOAD_BYTES, UploadsService } from './uploads.service.js';

@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get('pages/:pageId/uploads')
  @RequirePageRole('admin')
  list(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.uploads.list(pageId);
  }

  @Post('pages/:pageId/uploads')
  @RequirePageRole('admin')
  // +1 byte: o multer corta no limite e o serviço responde 413 com mensagem própria.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1 } }),
  )
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined,
    @Audit() audit: AuditContext,
  ) {
    return this.uploads.create(pageId, file, audit);
  }

  @Delete('pages/:pageId/uploads/:uploadId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.uploads.remove(pageId, uploadId, audit);
  }

  /**
   * Arquivo para exibição. Imutável (o ID muda a cada envio), servido com CSP
   * `sandbox` e `nosniff` para que um SVG aberto diretamente não execute nada.
   */
  @Public()
  @Get('public/uploads/:uploadId')
  async serve(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const upload = await this.uploads.findForServing(uploadId);
    assertCanView(upload.page, auth, req.ip);
    res.set({
      'Content-Type': upload.contentType,
      'Content-Length': String(upload.size),
      'Cache-Control':
        upload.page.visibility === 'public'
          ? 'public, max-age=31536000, immutable'
          : 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Content-Disposition': `inline; filename="${encodeURIComponent(upload.filename)}"`,
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    return new StreamableFile(this.uploads.stream(uploadId));
  }
}
