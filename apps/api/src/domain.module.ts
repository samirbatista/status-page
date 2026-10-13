import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { ComponentsController } from './components/components.controller.js';
import { ComponentsService } from './components/components.service.js';
import { IncidentsController } from './incidents/incidents.controller.js';
import { IncidentsService } from './incidents/incidents.service.js';
import { MaintenancesController } from './maintenances/maintenances.controller.js';
import { MaintenancesService } from './maintenances/maintenances.service.js';
import { PagesController } from './pages/pages.controller.js';
import { PagesService } from './pages/pages.service.js';
import { PublicController } from './public/public.controller.js';
import { PublicService } from './public/public.service.js';
import { TemplatesController } from './templates/templates.controller.js';
import { TemplatesService } from './templates/templates.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

@Module({
  controllers: [
    AuditController,
    ComponentsController,
    IncidentsController,
    MaintenancesController,
    PagesController,
    PublicController,
    TemplatesController,
    UsersController,
  ],
  providers: [
    AuditService,
    ComponentsService,
    IncidentsService,
    MaintenancesService,
    PagesService,
    PublicService,
    TemplatesService,
    UsersService,
  ],
})
export class DomainModule {}
