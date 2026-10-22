import {
  type LdapKind,
  type LdapSecurity,
  type PrivateAccessMode,
  type Theme,
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
  visibility: 'public' | 'private';
  /** Exibindo o rascunho do tema (pré-visualização de um Admin). */
  preview: boolean;
  theme: Theme;
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
  /** Só na página do incidente, quando publicado. */
  postmortem?: { html: string; publishedAt: string } | null;
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
  hasMetrics: boolean;
}

export type MfaStage = 'ok' | 'pending' | 'enroll';

export interface Me {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  isBreakGlass?: boolean;
  /** Etapa do segundo fator: `pending` e `enroll` só dão acesso à tela de MFA. */
  mfa: MfaStage;
  mfaMethods: ('totp' | 'webauthn')[];
  providers: string[];
  pages: { id: string; slug: string; name: string; role: Role }[];
}

export interface MfaStatus {
  stage: MfaStage;
  required: boolean;
  totp: boolean;
  webauthn: {
    id: string;
    name: string;
    rpId: string;
    createdAt: string;
    lastUsedAt: string | null;
  }[];
  recoveryCodesRemaining: number;
}

export interface LdapProvider {
  id: string;
  name: string;
  kind: LdapKind;
  enabled: boolean;
  position: number;
  host: string;
  port: number;
  security: LdapSecurity;
  verifyCertificate: boolean;
  caCertificate: string | null;
  bindDn: string;
  baseDn: string;
  userFilter: string;
  usernameAttribute: string;
  emailAttribute: string;
  nameAttribute: string;
  uniqueIdAttribute: string;
  nestedGroups: boolean;
  groupBaseDn: string | null;
  groupFilter: string | null;
  manualRolesWin: boolean;
  linkByEmail: boolean;
  timeoutMs: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  users: number;
  mappingCount?: number;
}

export interface LdapMapping {
  id: string;
  groupDn: string;
  pageId: string | null;
  role: Role;
  page: { name: string } | null;
}

export interface LdapProviderDetail extends LdapProvider {
  mappings: LdapMapping[];
}

export interface AdminPage {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultLocale: string;
  timezone: string;
  visibility: 'public' | 'private';
  privateAccess: PrivateAccessMode;
  allowedCidrs: string[];
  isDefault: boolean;
}

export interface ThemeState {
  draft: Theme;
  published: Theme;
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
}

export interface UploadInfo {
  id: string;
  kind: 'image' | 'font';
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface DomainInfo {
  id: string;
  hostname: string;
  verifiedAt: string | null;
  createdAt: string;
  record: { type: 'TXT'; name: string; value: string };
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
  isOwner: boolean;
  role: Exclude<Role, 'owner'>;
  /** Papel definido manualmente (falso: veio de um grupo LDAP). */
  manual: boolean;
  mfa: boolean;
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
  identities: {
    provider: string;
    username: string | null;
    disabledAt: string | null;
    lastSyncAt: string | null;
    ldapProvider: { name: string } | null;
  }[];
  pageRoles: { pageId: string; role: Role; manual: boolean }[];
  mfa: { totp: boolean; webauthn: number };
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

// --- F5: monitoramento ---------------------------------------------------------

export type MonitorType = 'http' | 'tcp' | 'icmp' | 'dns' | 'ssl';
export type AutomationMode = 'auto' | 'suggest';
export type MetricRange = 'day' | 'week' | 'month';

export interface Monitor {
  id: string;
  pageId: string;
  componentId: string | null;
  component: { id: string; name: string; status: ComponentStatus } | null;
  name: string;
  type: MonitorType;
  target: string;
  config: Record<string, unknown>;
  headerNames: string[];
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  mode: AutomationMode;
  failureStatus: ComponentStatus;
  templateId: string | null;
  publicMetrics: boolean;
  enabled: boolean;
  state: 'unknown' | 'up' | 'down';
  consecutiveFailures: number;
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
}

export interface CheckResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  detail?: string;
}

export interface MetricPoint {
  at: string;
  latencyMs: number | null;
  uptime: number | null;
}

export interface MetricSeries {
  range: MetricRange;
  from: string;
  to: string;
  bucketMinutes: number;
  uptime: number | null;
  avgLatencyMs: number | null;
  checks: number;
  points: MetricPoint[];
}

export interface MonitorResults extends MetricSeries {
  recent: { checkedAt: string; ok: boolean; latencyMs: number | null; error: string | null }[];
}

export interface PublicMetrics {
  range: MetricRange;
  monitors: (MetricSeries & {
    id: string;
    name: string;
    type: MonitorType;
    component: { id: string; name: string } | null;
  })[];
}

export type InboundKind = 'alertmanager' | 'grafana' | 'zabbix' | 'uptime_kuma' | 'generic';

export interface InboundRule {
  id?: string;
  matchField: string;
  pattern: string;
  componentId: string;
  status: ComponentStatus;
}

export interface GenericMapping {
  itemsPath: string;
  keyPath: string;
  namePath: string;
  statusPath: string;
  firingValues: string[];
  labelsPath: string;
  summaryPath: string;
}

export interface InboundSource {
  id: string;
  name: string;
  kind: InboundKind;
  mode: AutomationMode;
  templateId: string | null;
  enabled: boolean;
  hasHmac: boolean;
  url: string;
  mapping: GenericMapping;
  rules: InboundRule[];
  lastReceivedAt: string | null;
  lastResult: {
    alerts: number;
    matched: { name: string; firing: boolean; componentId: string; outcome: string }[];
    unmatched: string[];
  } | null;
}

export interface SuggestedAlert {
  id: string;
  kind: 'failure' | 'recovery';
  suggestedStatus: ComponentStatus;
  title: string;
  detail: string | null;
  source: 'monitor' | 'inbound';
  templateId: string | null;
  occurrences: number;
  lastSeenAt: string;
  createdAt: string;
  component: { id: string; name: string; status: ComponentStatus };
}

export interface Postmortem {
  incidentId: string;
  body: string;
  html: string;
  publishedAt: string | null;
  updatedAt: string;
}
