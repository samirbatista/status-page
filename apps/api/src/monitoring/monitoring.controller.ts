import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import {
  alertAcceptSchema,
  inboundRuleInputSchema,
  inboundSourceInputSchema,
  inboundSourceUpdateSchema,
  METRIC_RANGES,
  type MonitorInput,
  monitorInputSchema,
  postmortemPublishSchema,
  postmortemSchema,
} from '@status-page/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, RequirePageRole } from '../common/decorators.js';
import { Audit } from '../common/request-meta.js';
import { ZodBody, ZodQuery } from '../common/zod.pipe.js';
import { AlertsService } from './alerts.service.js';
import { InboundService } from './inbound.service.js';
import { MonitorsService } from './monitors.service.js';
import { PostmortemService } from './postmortem.service.js';

const rangeQuery = z.object({ range: z.enum(METRIC_RANGES).default('day') });
const alertsQuery = z.object({
  state: z.enum(['open', 'accepted', 'dismissed', 'resolved', 'all']).default('open'),
});
const rulesBody = z.object({ rules: z.array(inboundRuleInputSchema).max(200) });

@Controller('pages/:pageId/monitors')
export class MonitorsController {
  constructor(private readonly monitors: MonitorsService) {}

  @Get()
  @RequirePageRole('viewer')
  list(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.monitors.list(pageId);
  }

  @Post()
  @RequirePageRole('admin')
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodBody(monitorInputSchema) body: MonitorInput,
    @Audit() audit: AuditContext,
  ) {
    return this.monitors.create(pageId, body, audit);
  }

  /** Testa uma configuração ainda não salva. */
  @Post('test')
  @RequirePageRole('admin')
  @HttpCode(200)
  test(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodBody(monitorInputSchema) body: MonitorInput,
  ) {
    return this.monitors.test(pageId, body);
  }

  @Get(':monitorId')
  @RequirePageRole('viewer')
  get(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('monitorId', ParseUUIDPipe) monitorId: string,
  ) {
    return this.monitors.get(pageId, monitorId);
  }

  @Get(':monitorId/results')
  @RequirePageRole('viewer')
  results(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('monitorId', ParseUUIDPipe) monitorId: string,
    @ZodQuery(rangeQuery) query: z.infer<typeof rangeQuery>,
  ) {
    return this.monitors.results(pageId, monitorId, query.range);
  }

  @Put(':monitorId')
  @RequirePageRole('admin')
  update(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('monitorId', ParseUUIDPipe) monitorId: string,
    @ZodBody(monitorInputSchema) body: MonitorInput,
    @Audit() audit: AuditContext,
  ) {
    return this.monitors.update(pageId, monitorId, body, audit);
  }

  /** Testa a configuração informada usando os cabeçalhos salvos do monitor. */
  @Post(':monitorId/test')
  @RequirePageRole('admin')
  @HttpCode(200)
  testExisting(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('monitorId', ParseUUIDPipe) monitorId: string,
    @ZodBody(monitorInputSchema) body: MonitorInput,
  ) {
    return this.monitors.test(pageId, body, monitorId);
  }

  @Delete(':monitorId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('monitorId', ParseUUIDPipe) monitorId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.monitors.remove(pageId, monitorId, audit);
  }
}

@Controller('pages/:pageId/inbound-sources')
export class InboundSourcesController {
  constructor(private readonly inbound: InboundService) {}

  @Get()
  @RequirePageRole('admin')
  list(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.inbound.list(pageId);
  }

  @Post()
  @RequirePageRole('admin')
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodBody(inboundSourceInputSchema) body: z.infer<typeof inboundSourceInputSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.inbound.create(pageId, body, audit);
  }

  @Put(':sourceId')
  @RequirePageRole('admin')
  update(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @ZodBody(inboundSourceUpdateSchema) body: z.infer<typeof inboundSourceUpdateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.inbound.update(pageId, sourceId, body, audit);
  }

  @Put(':sourceId/rules')
  @RequirePageRole('admin')
  rules(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @ZodBody(rulesBody) body: z.infer<typeof rulesBody>,
    @Audit() audit: AuditContext,
  ) {
    return this.inbound.setRules(pageId, sourceId, body.rules, audit);
  }

  @Post(':sourceId/rotate-token')
  @RequirePageRole('admin')
  @HttpCode(200)
  rotate(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Audit() audit: AuditContext,
  ) {
    return this.inbound.rotateToken(pageId, sourceId, audit);
  }

  @Delete(':sourceId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.inbound.remove(pageId, sourceId, audit);
  }
}

/** URL chamada pelas ferramentas externas (Alertmanager, Grafana, Zabbix, Uptime Kuma...). */
@Public()
@Controller('hooks/in')
export class InboundHooksController {
  constructor(private readonly inbound: InboundService) {}

  @Post(':sourceId/:token')
  @HttpCode(202)
  receive(
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature?: string,
    @Headers('x-hub-signature-256') hubSignature?: string,
  ) {
    return this.inbound.receive(sourceId, token, body, req.rawBody, signature ?? hubSignature);
  }
}

@Controller('pages/:pageId/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @RequirePageRole('viewer')
  list(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodQuery(alertsQuery) query: z.infer<typeof alertsQuery>,
  ) {
    return this.alerts.list(pageId, query.state);
  }

  @Post(':alertId/accept')
  @RequirePageRole('operator')
  @HttpCode(200)
  accept(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @ZodBody(alertAcceptSchema) body: z.infer<typeof alertAcceptSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.alerts.accept(pageId, alertId, body.openIncident, audit);
  }

  @Post(':alertId/dismiss')
  @RequirePageRole('operator')
  @HttpCode(204)
  async dismiss(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.alerts.dismiss(pageId, alertId, audit);
  }
}

@Controller('pages/:pageId/incidents/:incidentId/postmortem')
export class PostmortemController {
  constructor(private readonly postmortems: PostmortemService) {}

  @Get()
  @RequirePageRole('viewer')
  async get(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
  ) {
    return { postmortem: await this.postmortems.get(pageId, incidentId) };
  }

  @Put()
  @RequirePageRole('operator')
  save(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @ZodBody(postmortemSchema) body: z.infer<typeof postmortemSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.postmortems.save(pageId, incidentId, body.body, audit);
  }

  @Post('publish')
  @RequirePageRole('operator')
  @HttpCode(200)
  publish(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @ZodBody(postmortemPublishSchema) body: z.infer<typeof postmortemPublishSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.postmortems.publish(pageId, incidentId, body.notify, audit);
  }

  @Post('unpublish')
  @RequirePageRole('operator')
  @HttpCode(200)
  unpublish(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Audit() audit: AuditContext,
  ) {
    return this.postmortems.unpublish(pageId, incidentId, audit);
  }
}
