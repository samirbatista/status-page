import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Ignora a API, o healthcheck, arquivos internos do Next e arquivos estáticos.
  matcher: '/((?!api|healthz|_next|_vercel|.*\\..*).*)',
};
