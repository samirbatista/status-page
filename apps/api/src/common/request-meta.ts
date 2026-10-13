import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { type AuditContext } from '@status-page/core';
import { type AuthContext } from './auth.types.js';

export interface RequestWithAuth extends Request {
  auth?: AuthContext;
}

export function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

/** Contexto para o log de auditoria: autor, IP e user-agent da requisição. */
export const Audit = createParamDecorator((_: unknown, ctx: ExecutionContext): AuditContext => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
  return { actorId: req.auth?.user.id ?? null, ...requestMeta(req) };
});

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<RequestWithAuth>().auth;
});
