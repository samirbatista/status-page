import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import {
  channelCreateSchema,
  channelUpdateSchema,
  smtpSettingsSchema,
  telegramSettingsSchema,
  templateUpsertSchema,
  whatsappSettingsSchema,
} from '@status-page/shared';
import { z } from 'zod';
import { RequireOwner, RequirePageRole } from '../common/decorators.js';
import { listQuerySchema } from '../common/list-query.js';
import { Audit } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SubscribersService } from '../subscribers/subscribers.service.js';
import { ChannelsService } from './channels.service.js';
import { ProviderSettingsService } from './provider-settings.service.js';

const deliveriesQuery = listQuerySchema.extend({
  status: z.enum(['pending', 'sent', 'failed', 'skipped']).optional(),
});
const subscribersQuery = z.object({
  status: z.enum(['pending', 'active', 'unsubscribed']).optional(),
  kind: z.string().max(20).optional(),
});
const importBody = z.object({ csv: z.string().min(1).max(500_000) });
const emailBody = z.object({ to: z.email() });
const phoneBody = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, { message: 'invalid_phone' }),
});

/** Notificações da página: canais da equipe, templates, entregas e assinantes. */
@Controller('pages/:pageId')
export class NotificationsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly subscribers: SubscribersService,
  ) {}

  @Get('notification-channels')
  @RequirePageRole('admin')
  listChannels(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.channels.list(pageId);
  }

  @Post('notification-channels')
  @RequirePageRole('admin')
  createChannel(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(channelCreateSchema)) body: z.infer<typeof channelCreateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.channels.create(pageId, body, audit);
  }

  @Put('notification-channels/:channelId')
  @RequirePageRole('admin')
  updateChannel(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body(new ZodPipe(channelUpdateSchema)) body: z.infer<typeof channelUpdateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.channels.update(pageId, channelId, body, audit);
  }

  @Delete('notification-channels/:channelId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async removeChannel(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.channels.remove(pageId, channelId, audit);
  }

  @Post('notification-channels/:channelId/test')
  @RequirePageRole('admin')
  @HttpCode(200)
  testChannel(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ) {
    return this.channels.test(pageId, channelId);
  }

  // --- Templates ---------------------------------------------------------------------

  @Get('notification-templates')
  @RequirePageRole('admin')
  templates(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.channels.templates(pageId);
  }

  @Put('notification-templates')
  @RequirePageRole('admin')
  upsertTemplate(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(templateUpsertSchema)) body: z.infer<typeof templateUpsertSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.channels.upsertTemplate(pageId, body, audit);
  }

  @Post('notification-templates/preview')
  @RequirePageRole('admin')
  @HttpCode(200)
  preview(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(templateUpsertSchema)) body: z.infer<typeof templateUpsertSchema>,
  ) {
    return this.channels.preview(pageId, body);
  }

  @Delete('notification-templates/:templateId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async removeTemplate(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.channels.removeTemplate(pageId, templateId, audit);
  }

  // --- Entregas ------------------------------------------------------------------------

  @Get('notification-deliveries')
  @RequirePageRole('operator')
  deliveries(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Query(new ZodPipe(deliveriesQuery)) query: z.infer<typeof deliveriesQuery>,
  ) {
    return this.channels.deliveries(pageId, query);
  }

  @Post('notification-deliveries/:deliveryId/resend')
  @RequirePageRole('admin')
  @HttpCode(204)
  async resend(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.channels.resend(pageId, deliveryId, audit);
  }

  // --- Assinantes ----------------------------------------------------------------------

  @Get('subscribers')
  @RequirePageRole('admin')
  listSubscribers(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Query(new ZodPipe(subscribersQuery)) query: z.infer<typeof subscribersQuery>,
  ) {
    return this.subscribers.list(pageId, query);
  }

  @Get('subscribers/export.csv')
  @RequirePageRole('admin')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="assinantes.csv"')
  @Header('Cache-Control', 'no-store')
  exportSubscribers(@Param('pageId', ParseUUIDPipe) pageId: string, @Audit() audit: AuditContext) {
    return this.subscribers.exportCsv(pageId, audit);
  }

  @Post('subscribers/import')
  @RequirePageRole('admin')
  @HttpCode(200)
  importSubscribers(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(importBody)) body: z.infer<typeof importBody>,
    @Audit() audit: AuditContext,
  ) {
    return this.subscribers.importCsv(pageId, body.csv, audit);
  }

  @Delete('subscribers/:subscriberId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async removeSubscriber(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('subscriberId', ParseUUIDPipe) subscriberId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.subscribers.remove(pageId, subscriberId, audit);
  }
}

/** Provedores globais (SMTP, bot do Telegram, WhatsApp Cloud API): só o Dono. */
@Controller('notifications/settings')
@RequireOwner()
export class ProviderSettingsController {
  constructor(private readonly settings: ProviderSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put('smtp')
  smtp(
    @Body(new ZodPipe(smtpSettingsSchema)) body: z.infer<typeof smtpSettingsSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.settings.saveSmtp(body, audit);
  }

  @Put('telegram')
  telegram(
    @Body(new ZodPipe(telegramSettingsSchema)) body: z.infer<typeof telegramSettingsSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.settings.saveTelegram(body, audit);
  }

  @Put('whatsapp')
  whatsapp(
    @Body(new ZodPipe(whatsappSettingsSchema)) body: z.infer<typeof whatsappSettingsSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.settings.saveWhatsapp(body, audit);
  }

  @Post('smtp/test')
  @HttpCode(200)
  testSmtp(@Body(new ZodPipe(emailBody)) body: z.infer<typeof emailBody>) {
    return this.settings.testSmtp(body.to);
  }

  @Post('whatsapp/test')
  @HttpCode(200)
  testWhatsapp(@Body(new ZodPipe(phoneBody)) body: z.infer<typeof phoneBody>) {
    return this.settings.testWhatsapp(body.phone);
  }
}
