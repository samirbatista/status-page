import { readFileSync } from 'node:fs';

/** Versão da aplicação (package.json da API, igual à da release). */
export const APP_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
