import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { DomainsController } from './domains/domains.controller.js';
import { DomainsService } from './domains/domains.service.js';
import { ThemeController } from './theme/theme.controller.js';
import { ThemeService } from './theme/theme.service.js';
import { UploadsController } from './uploads/uploads.controller.js';
import { UploadsService } from './uploads/uploads.service.js';
import { ComponentsController } from './components/components.controller.js';
import { ComponentsService } from './components/components.service.js';
import { IncidentsController } from './incidents/incidents.controller.js';
import { IncidentsService } from './incidents/incidents.service.js';
import { MaintenancesController } from './maintenances/maintenances.controller.js';
import { MaintenancesService } from './maintenances/maintenances.service.js';
import {
  NotificationsController,
  ProviderSettingsController,
} from './notifications/notifications.controller.js';
import { ChannelsService } from './notifications/channels.service.js';
import { ProviderSettingsService } from './notifications/provider-settings.service.js';
import { PagesController } from './pages/pages.controller.js';
import { SubscribersService } from './subscribers/subscribers.service.js';
import { SubscriptionsController } from './subscribers/subscriptions.controller.js';
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
    DomainsController,
    IncidentsController,
    MaintenancesController,
    NotificationsController,
    PagesController,
    ProviderSettingsController,
    PublicController,
    SubscriptionsController,
    TemplatesController,
    ThemeController,
    UploadsController,
    UsersController,
  ],
  providers: [
    AuditService,
    ChannelsService,
    ComponentsService,
    DomainsService,
    IncidentsService,
    MaintenancesService,
    PagesService,
    ProviderSettingsService,
    PublicService,
    SubscribersService,
    TemplatesService,
    ThemeService,
    UploadsService,
    UsersService,
  ],
})
export class DomainModule {}
