import { Global, Module } from '@nestjs/common';
import { ApiTokensController } from '../api-tokens/api-tokens.controller.js';
import { ApiTokensService } from '../api-tokens/api-tokens.service.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { LdapController } from '../ldap/ldap.controller.js';
import { LdapService } from '../ldap/ldap.service.js';
import { AuthSettingsService } from './auth-settings.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { MfaController } from './mfa.controller.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  controllers: [ApiTokensController, AuthController, MfaController, LdapController],
  providers: [
    ApiTokensService,
    AuthService,
    AuthSettingsService,
    LdapService,
    LoginThrottleService,
    MfaService,
    PasswordService,
    SessionService,
    RateLimitService,
  ],
  exports: [
    ApiTokensService,
    AuthSettingsService,
    LdapService,
    MfaService,
    PasswordService,
    SessionService,
    RateLimitService,
  ],
})
export class AuthModule {}
