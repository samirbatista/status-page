import { Global, Module } from '@nestjs/common';
import { RateLimitService } from '../common/rate-limit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginThrottleService, PasswordService, SessionService, RateLimitService],
  exports: [PasswordService, SessionService, RateLimitService],
})
export class AuthModule {}
