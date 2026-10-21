import type { Request, Response } from 'express';
import { SESSION_COOKIE } from './session.service.js';

/** Grava o cookie de sessão (httpOnly, SameSite=Lax; Secure atrás de HTTPS). */
export function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // Atrás do Caddy com HTTPS, req.secure vem do X-Forwarded-Proto.
    secure: req.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

/**
 * Domínio (RP ID) e origem usados no WebAuthn: o endereço pelo qual o navegador
 * acessa o painel. Atrás do Caddy (ou do Next em desenvolvimento), vem do
 * X-Forwarded-Host; o navegador garante que a origem assinada é a real.
 */
export function relyingParty(req: Request): { rpID: string; origin: string } {
  const raw = req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost';
  const host = raw.split(',')[0]!.trim();
  const rpID = host.replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
  return { rpID, origin: `${req.protocol}://${host}` };
}
