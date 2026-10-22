import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { METRIC_RANGES } from '@status-page/shared';
import { z } from 'zod';
import { cacheControlFor } from '../access/page-access.js';
import { type AuthContext } from '../common/auth.types.js';
import { Public } from '../common/decorators.js';
import { CurrentAuth } from '../common/request-meta.js';
import { ZodQuery } from '../common/zod.pipe.js';
import { PublicService, type Viewer } from './public.service.js';

const historyQuery = z.object({ month: z.string() });
const metricsQuery = z.object({ range: z.enum(METRIC_RANGES).default('day') });
const summaryQuery = z.object({ preview: z.enum(['draft']).optional() });

@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicData: PublicService) {}

  /** Slug da página exibida na raiz do site. */
  @Get('default')
  async defaultPage() {
    const slug = await this.publicData.defaultSlug();
    if (!slug) throw new NotFoundException({ message: 'page_not_found' });
    return { slug };
  }

  @Get('pages/:slug')
  async summary(
    @Param('slug') slug: string,
    @ZodQuery(summaryQuery) query: z.infer<typeof summaryQuery>,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const viewer: Viewer = { auth, ip: req.ip, preview: query.preview === 'draft' };
    const summary = await this.publicData.summary(slug, viewer);
    res.set(
      'Cache-Control',
      summary.page.preview ? 'private, no-store' : cacheControlFor(summary.page),
    );
    return summary;
  }

  @Get('pages/:slug/history')
  async history(
    @Param('slug') slug: string,
    @ZodQuery(historyQuery) query: z.infer<typeof historyQuery>,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.publicData.history(slug, query.month, { auth, ip: req.ip });
    res.set('Cache-Control', cacheControlFor(data.page));
    return data;
  }

  @Get('pages/:slug/metrics')
  async metrics(
    @Param('slug') slug: string,
    @ZodQuery(metricsQuery) query: z.infer<typeof metricsQuery>,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.publicData.metrics(slug, query.range, { auth, ip: req.ip });
    res.set('Cache-Control', cacheControlFor(data.page));
    return data;
  }

  @Get('pages/:slug/incidents/:incidentId')
  async incident(
    @Param('slug') slug: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.publicData.incident(slug, incidentId, { auth, ip: req.ip });
    res.set('Cache-Control', cacheControlFor(data.page));
    return data;
  }

  @Get('pages/:slug/maintenances/:maintenanceId')
  async maintenance(
    @Param('slug') slug: string,
    @Param('maintenanceId', ParseUUIDPipe) maintenanceId: string,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.publicData.maintenance(slug, maintenanceId, { auth, ip: req.ip });
    res.set('Cache-Control', cacheControlFor(data.page));
    return data;
  }
}
