import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { cacheControlFor } from '../access/page-access.js';
import { type AuthContext } from '../common/auth.types.js';
import { Public } from '../common/decorators.js';
import { CurrentAuth } from '../common/request-meta.js';
import { DistributionService } from './distribution.service.js';

type Viewer = { auth?: AuthContext; ip?: string | null };

/** JSON de status, feeds RSS/Atom, selo SVG e widget de uma página. */
@Public()
@Controller('public/pages/:slug')
export class DistributionController {
  constructor(private readonly distribution: DistributionService) {}

  /** Status atual em JSON. Páginas públicas liberam CORS para uso em outros sites. */
  @Get('status.json')
  async status(
    @Param('slug') slug: string,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.distribution.status(slug, this.viewer(auth, req));
    res.set('Cache-Control', cacheControlFor(data.page));
    if (data.page.visibility === 'public') res.set('Access-Control-Allow-Origin', '*');
    return data;
  }

  @Get('feed.atom')
  async atom(
    @Param('slug') slug: string,
    @Query('lang') lang: string | undefined,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const feed = await this.distribution.feed(slug, this.viewer(auth, req), lang);
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.set('Cache-Control', this.cache(feed.page.visibility, 60));
    return this.distribution.atom(feed);
  }

  @Get('feed.rss')
  async rss(
    @Param('slug') slug: string,
    @Query('lang') lang: string | undefined,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const feed = await this.distribution.feed(slug, this.viewer(auth, req), lang);
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.set('Cache-Control', this.cache(feed.page.visibility, 60));
    return this.distribution.rss(feed);
  }

  /** Selo para README, wiki ou intranet: `<img src=".../badge.svg">`. */
  @Get('badge.svg')
  async badge(
    @Param('slug') slug: string,
    @Query('lang') lang: string | undefined,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { page, svg } = await this.distribution.badge(slug, this.viewer(auth, req), lang);
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', this.cache(page.visibility, 60));
    // SVG aberto direto no navegador não executa nada.
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return svg;
  }

  /** Script do mini painel: `<script src=".../widget.js" async></script>`. */
  @Get('widget.js')
  async widget(
    @Param('slug') slug: string,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { page, js } = await this.distribution.widget(slug, this.viewer(auth, req));
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', this.cache(page.visibility, 300));
    return js;
  }

  private viewer(auth: AuthContext | undefined, req: Request): Viewer {
    return { auth, ip: req.ip };
  }

  private cache(visibility: string, seconds: number): string {
    return visibility === 'public' ? `public, max-age=${seconds}` : 'private, no-store';
  }
}
