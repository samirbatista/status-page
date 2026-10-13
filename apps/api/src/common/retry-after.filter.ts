import { type ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/** Converte o `retryAfter` das respostas 429 no cabeçalho HTTP `Retry-After`. */
@Catch(HttpException)
export class RetryAfterFilter extends BaseExceptionFilter {
  override catch(exception: HttpException, host: ArgumentsHost): void {
    if (exception.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
      const body = exception.getResponse() as { retryAfter?: number };
      if (body.retryAfter) {
        host
          .switchToHttp()
          .getResponse<Response>()
          .setHeader('Retry-After', String(body.retryAfter));
      }
    }
    super.catch(exception, host);
  }
}
