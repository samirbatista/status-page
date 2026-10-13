import {
  type ComponentStatus,
  type IncidentImpact,
  type IncidentStatus,
  type MaintenanceStatus,
  type Role,
} from '@status-page/shared';

/** Formatos JSON retornados pela API (datas chegam como string ISO). */

export interface DailyUptime {
  date: string;
  uptime: number | null;
  worstStatus: ComponentStatus | null;
  partialOutageMinutes: number;
  majorOutageMinutes: number;
}

export interface PublicPage {
  slug: string;
  name: string;
  description: string | null;
  timezone: string;
  defaultLocale: string;
}

export interface PublicIncidentUpdate {
  id: string;
  status: IncidentStatus;
  body: string;
  displayAt: string;
  components: { status: ComponentStatus; component: { id: string; name: string } }[];
}

export interface PublicIncident {
  id: string;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  startedAt: string;
  resolvedAt: string | null;
  updates: PublicIncidentUpdate[];
}

export interface PublicMaintenance {
  id: string;
  title: string;
  status: MaintenanceStatus;
  scheduledStart: string;
  scheduledEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  components: { component: { id: string; name: string } }[];
  updates: { id: string; status: MaintenanceStatus; body: string; createdAt: string }[];
}

export interface PublicSummary {
  page: PublicPage;
  status: ComponentStatus;
  groups: { id: string; name: string; collapsed: boolean }[];
  components: {
    id: string;
    name: string;
    description: string | null;
    status: ComponentStatus;
    groupId: string | null;
    uptime: { days: DailyUptime[]; uptime: number | null } | null;
  }[];
  activeIncidents: PublicIncident[];
  maintenances: PublicMaintenance[];
  pastIncidents: PublicIncident[];
  pastIncidentDays: number;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  providers: string[];
  pages: { id: string; slug: string; name: string; role: Role }[];
}

export interface AdminPage {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultLocale: string;
  timezone: string;
  visibility: 'public' | 'private';
  isDefault: boolean;
}

export interface Structure {
  groups: { id: string; name: string; collapsed: boolean; position: number }[];
  components: {
    id: string;
    name: string;
    description: string | null;
    status: ComponentStatus;
    groupId: string | null;
    position: number;
    showUptime: boolean;
    sharedWithPages: number;
  }[];
}

export interface Person {
  id: string;
  name: string;
}

export interface AdminIncident {
  id: string;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  backfilled: boolean;
  startedAt: string;
  resolvedAt: string | null;
  createdBy: Person | null;
  updates: (PublicIncidentUpdate & { notify: boolean; createdBy: Person | null })[];
}

export interface AdminMaintenance {
  id: string;
  title: string;
  status: MaintenanceStatus;
  scheduledStart: string;
  scheduledEnd: string;
  autoStart: boolean;
  autoComplete: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: Person | null;
  components: { component: { id: string; name: string; status: ComponentStatus } }[];
  updates: {
    id: string;
    status: MaintenanceStatus;
    body: string;
    createdAt: string;
    createdBy: Person | null;
  }[];
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string;
}

export interface IncidentTemplate {
  id: string;
  name: string;
  title: string;
  body: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  componentIds: string[];
  componentStatus: ComponentStatus | null;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  disabledAt: string | null;
  role: Exclude<Role, 'owner'>;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  isBreakGlass: boolean;
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  identities: { provider: string }[];
  pageRoles: { pageId: string; role: Role }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  pageId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}
