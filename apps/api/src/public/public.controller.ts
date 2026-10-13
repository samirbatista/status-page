import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PublicService } from './public.service.js';

const historyQuery = z.object({ month: z.string() });

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
  summary(@Param('slug') slug: string) {
    return this.publicData.summary(slug);
  }

  @Get('pages/:slug/history')
  history(
    @Param('slug') slug: string,
    @Query(new ZodPipe(historyQuery)) query: z.infer<typeof historyQuery>,
  ) {
    return this.publicData.history(slug, query.month);
  }

  @Get('pages/:slug/incidents/:incidentId')
  incident(@Param('slug') slug: string, @Param('incidentId', ParseUUIDPipe) incidentId: string) {
    return this.publicData.incident(slug, incidentId);
  }

  @Get('pages/:slug/maintenances/:maintenanceId')
  maintenance(
    @Param('slug') slug: string,
    @Param('maintenanceId', ParseUUIDPipe) maintenanceId: string,
  ) {
    return this.publicData.maintenance(slug, maintenanceId);
  }
}
