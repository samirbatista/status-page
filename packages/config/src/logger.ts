import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function loggerOptions(service: string, level = 'info'): LoggerOptions {
  return {
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

export function createLogger(service: string, level = 'info'): Logger {
  return pino(loggerOptions(service, level));
}
