import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { ConfigExportService } from './config-transfer/config-export.service.js';
import { ConfigImportService } from './config-transfer/config-import.service.js';
import { ConfigTransferController } from './config-transfer/config-transfer.controller.js';
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
import {
  AlertsController,
  InboundHooksController,
  InboundSourcesController,
  MonitorsController,
  PostmortemController,
} from './monitoring/monitoring.controller.js';
import { AlertsService } from './monitoring/alerts.service.js';
import { InboundService } from './monitoring/inbound.service.js';
import { MonitorsService } from './monitoring/monitors.service.js';
import { PostmortemService } from './monitoring/postmortem.service.js';
import { PagesController } from './pages/pages.controller.js';
import { SubscribersService } from './subscribers/subscribers.service.js';
import { SubscriptionsController } from './subscribers/subscriptions.controller.js';
import { PagesService } from './pages/pages.service.js';
import { DistributionController } from './public/distribution.controller.js';
import { DistributionService } from './public/distribution.service.js';
import { PublicController } from './public/public.controller.js';
import { PublicService } from './public/public.service.js';
import { TemplatesController } from './templates/templates.controller.js';
import { TemplatesService } from './templates/templates.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

@Module({
  controllers: [
    AlertsController,
    AuditController,
    ConfigTransferController,
    DistributionController,
    ComponentsController,
    DomainsController,
    InboundHooksController,
    InboundSourcesController,
    IncidentsController,
    MaintenancesController,
    MonitorsController,
    NotificationsController,
    PagesController,
    PostmortemController,
    ProviderSettingsController,
    PublicController,
    SubscriptionsController,
    TemplatesController,
    ThemeController,
    UploadsController,
    UsersController,
  ],
  providers: [
    AlertsService,
    AuditService,
    ConfigExportService,
    ConfigImportService,
    DistributionService,
    ChannelsService,
    ComponentsService,
    DomainsService,
    InboundService,
    IncidentsService,
    MaintenancesService,
    MonitorsService,
    PagesService,
    PostmortemService,
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
