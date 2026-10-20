import { Inject, Injectable } from '@nestjs/common';
import { SecretBox } from '@status-page/core';
import { API_ENV, type ApiEnv } from '../env.js';

/** Cifra de segredos em repouso com a chave do APP_SECRET. */
@Injectable()
export class SecretsService extends SecretBox {
  constructor(@Inject(API_ENV) env: ApiEnv) {
    super(env.APP_SECRET);
  }
}
