import { Controller, Get, Header } from '@nestjs/common';
import { auditQuerySchema, type AuditQuery } from '@status-page/shared';
import { type AuthContext } from '../common/auth.types.js';
import { CurrentAuth } from '../common/request-meta.js';
import { ZodQuery } from '../common/zod.pipe.js';
import { AuditService } from './audit.service.js';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @ZodQuery(auditQuerySchema) query: AuditQuery) {
    return this.audit.list(auth, query);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="auditoria.csv"')
  csv(@CurrentAuth() auth: AuthContext, @ZodQuery(auditQuerySchema) query: AuditQuery) {
    return this.audit.csv(auth, query);
  }
}
