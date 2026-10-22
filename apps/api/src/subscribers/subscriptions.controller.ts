import { Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  subscribeSchema,
  subscriptionCodeSchema,
  subscriptionUpdateSchema,
  type SubscribeInput,
} from '@status-page/shared';
import { z } from 'zod';
import { type AuthContext } from '../common/auth.types.js';
import { Public } from '../common/decorators.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { CurrentAuth, requestMeta } from '../common/request-meta.js';
import { ZodBody, ZodPipe } from '../common/zod.pipe.js';
import { SubscribersService } from './subscribers.service.js';

const token = z.string().regex(/^[\w-]{20,100}$/);

/** Inscrição pública: assinar, confirmar o código, gerenciar e cancelar. */
@Public()
@Controller('public')
export class SubscriptionsController {
  constructor(
    private readonly subscribers: SubscribersService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async limit(req: Request, bucket: string, max = 30) {
    await this.rateLimit.enforce(`${bucket}:${requestMeta(req).ip}`, max, 60);
  }

  @Get('pages/:slug/subscribe')
  options(
    @Param('slug') slug: string,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
  ) {
    return this.subscribers.options(slug, auth, requestMeta(req).ip);
  }

  @Post('pages/:slug/subscriptions')
  @HttpCode(200)
  async subscribe(
    @Param('slug') slug: string,
    @ZodBody(subscribeSchema) body: SubscribeInput,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() req: Request,
  ) {
    await this.limit(req, 'subscribe-burst', 10);
    return this.subscribers.subscribe(slug, body, auth, requestMeta(req));
  }

  @Post('subscriptions/pending/:token/confirm')
  @HttpCode(200)
  async confirm(
    @Param('token', new ZodPipe(token)) pendingToken: string,
    @ZodBody(subscriptionCodeSchema) body: z.infer<typeof subscriptionCodeSchema>,
    @Req() req: Request,
  ) {
    await this.limit(req, 'subscription-confirm');
    return this.subscribers.confirm(pendingToken, body.code, requestMeta(req));
  }

  @Post('subscriptions/pending/:token/resend')
  @HttpCode(200)
  async resend(@Param('token', new ZodPipe(token)) pendingToken: string, @Req() req: Request) {
    await this.limit(req, 'subscription-resend', 10);
    return this.subscribers.resend(pendingToken, requestMeta(req));
  }

  @Get('subscriptions/pending/:token')
  async pending(@Param('token', new ZodPipe(token)) pendingToken: string, @Req() req: Request) {
    await this.limit(req, 'subscription-status', 120);
    return this.subscribers.pendingStatus(pendingToken);
  }

  @Post('subscriptions/invite/:token')
  @HttpCode(200)
  async invite(@Param('token', new ZodPipe(token)) inviteToken: string, @Req() req: Request) {
    await this.limit(req, 'subscription-invite');
    return this.subscribers.acceptInvite(inviteToken, requestMeta(req));
  }

  @Get('subscriptions/:token')
  async manage(@Param('token', new ZodPipe(token)) manageToken: string, @Req() req: Request) {
    await this.limit(req, 'subscription-manage', 60);
    return this.subscribers.manageGet(manageToken);
  }

  @Put('subscriptions/:token')
  async update(
    @Param('token', new ZodPipe(token)) manageToken: string,
    @ZodBody(subscriptionUpdateSchema) body: z.infer<typeof subscriptionUpdateSchema>,
    @Req() req: Request,
  ) {
    await this.limit(req, 'subscription-manage', 60);
    return this.subscribers.manageUpdate(manageToken, body, requestMeta(req));
  }

  @Post('subscriptions/:token/unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Param('token', new ZodPipe(token)) manageToken: string, @Req() req: Request) {
    await this.limit(req, 'subscription-manage', 60);
    return this.subscribers.unsubscribe(manageToken, requestMeta(req));
  }

  @Delete('subscriptions/:token')
  @HttpCode(204)
  async erase(@Param('token', new ZodPipe(token)) manageToken: string, @Req() req: Request) {
    await this.limit(req, 'subscription-manage', 60);
    await this.subscribers.erase(manageToken, requestMeta(req));
  }
}
