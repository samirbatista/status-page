import { messages } from '@status-page/i18n';
import {
  isLocale,
  type Locale,
  type NotificationEventType,
  TEMPLATE_VARIABLES,
  templateVariables,
} from '@status-page/shared';
import { STRINGS } from './defaults.js';
import { type EventPayload, type MessageLinks, type RenderedMessage } from './types.js';

/** Substitui `{{ nome }}` pelos valores; variáveis desconhecidas viram texto vazio. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => vars[name] ?? '');
}

/** Variáveis do template que não existem (para recusar ao salvar). */
export function unknownVariables(template: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  return [...new Set(templateVariables(template).filter((v) => !known.has(v)))];
}

export function resolveLocale(value: string | null | undefined): Locale {
  return value && isLocale(value) ? value : 'pt-BR';
}

function formatDate(iso: string, locale: Locale, timeZone: string): string {
  try {
    // dateStyle/timeStyle não combinam com timeZoneName: campos explícitos.
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

/** Valores das variáveis de template para o evento, no idioma do destinatário. */
export function templateVars(
  payload: EventPayload,
  locale: Locale,
  links: MessageLinks,
): Record<string, string> {
  const t = messages[locale];
  const s = STRINGS[locale];
  const { incident, maintenance } = payload;
  const components = payload.components.map((c) => c.name);
  return {
    'page.name': payload.page.name,
    'page.url': links.pageUrl,
    'event.label': s.events[payload.type].label,
    'incident.title': incident?.title ?? '',
    'incident.status': incident ? t.incident[incident.status] : '',
    'incident.impact': incident ? t.incident.impact[incident.impact] : '',
    'incident.url': incident ? links.itemUrl : '',
    'maintenance.title': maintenance?.title ?? '',
    'maintenance.status': maintenance ? t.maintenance.status[maintenance.status] : '',
    'maintenance.start': maintenance
      ? formatDate(maintenance.scheduledStart, locale, payload.page.timezone)
      : '',
    'maintenance.end': maintenance
      ? formatDate(maintenance.scheduledEnd, locale, payload.page.timezone)
      : '',
    'maintenance.url': maintenance ? links.itemUrl : '',
    // Atualização sem texto (ex.: início automático): mensagem padrão traduzida.
    'update.body':
      payload.update?.body ||
      (maintenance ? t.maintenance.defaultBody[maintenance.status] : '') ||
      '',
    components: components.join(', ') || '—',
    'component.name': components[0] ?? '',
  };
}

const IMPACT_COLORS = { none: '#16a34a', minor: '#ca8a04', major: '#ea580c', critical: '#dc2626' };
const MAINTENANCE_COLOR = '#2563eb';
const RESOLVED_COLOR = '#16a34a';

function colorFor(payload: EventPayload): string {
  if (payload.type === 'incident_resolved' || payload.type === 'maintenance_completed') {
    return RESOLVED_COLOR;
  }
  if (payload.incident) return IMPACT_COLORS[payload.incident.impact];
  return MAINTENANCE_COLOR;
}

export interface RenderOptions {
  locale: string | null | undefined;
  links: MessageLinks;
  /** Template personalizado (sem ele, vale o padrão do idioma). */
  template?: { subject: string | null; body: string } | null;
}

/** Monta a mensagem de um evento para um destinatário. */
export function renderMessage(payload: EventPayload, options: RenderOptions): RenderedMessage {
  const locale = resolveLocale(options.locale);
  const s = STRINGS[locale];
  const t = messages[locale];
  const vars = templateVars(payload, locale, options.links);
  const fallback = s.events[payload.type];
  const subject = interpolate(options.template?.subject || fallback.subject, vars).trim();
  const text = interpolate(options.template?.body || fallback.body, vars).trim();

  const facts: RenderedMessage['facts'] = [];
  if (payload.incident) {
    facts.push({ label: s.facts.status, value: t.incident[payload.incident.status] });
    facts.push({ label: s.facts.impact, value: t.incident.impact[payload.incident.impact] });
  }
  if (payload.maintenance) {
    facts.push({ label: s.facts.status, value: t.maintenance.status[payload.maintenance.status] });
    facts.push({
      label: s.facts.window,
      value: `${vars['maintenance.start']} – ${vars['maintenance.end']}`,
    });
  }
  if (payload.components.length > 0) {
    facts.push({ label: s.facts.components, value: vars.components! });
  }

  return {
    locale,
    event: payload.type,
    subject,
    text,
    title: payload.incident?.title ?? payload.maintenance?.title ?? payload.page.name,
    color: colorFor(payload),
    facts,
    links: options.links,
    labels: {
      view: s.view,
      manage: s.manage,
      unsubscribe: s.unsubscribe,
      footer: interpolate(s.footer, vars),
    },
  };
}

/** Mensagem do botão "Enviar teste" de um canal. */
export function renderTestMessage(
  page: { name: string },
  locale: string | null | undefined,
  links: MessageLinks,
): RenderedMessage {
  const l = resolveLocale(locale);
  const s = STRINGS[l];
  const vars = { 'page.name': page.name };
  return {
    locale: l,
    event: 'incident_updated' as NotificationEventType,
    subject: `[${page.name}] ${s.test.title}`,
    text: interpolate(s.test.body, vars),
    title: s.test.title,
    color: MAINTENANCE_COLOR,
    facts: [],
    links,
    labels: {
      view: s.view,
      manage: s.manage,
      unsubscribe: s.unsubscribe,
      footer: interpolate(s.footer, vars),
    },
  };
}

/** Textos do código de confirmação e do convite de importação. */
export function verificationTexts(
  kind: 'code' | 'invite',
  locale: string | null | undefined,
  vars: { pageName: string; code?: string; link?: string },
): { subject: string; text: string } {
  const s = STRINGS[resolveLocale(locale)][kind];
  const values = { 'page.name': vars.pageName, code: vars.code ?? '', link: vars.link ?? '' };
  return { subject: interpolate(s.subject, values), text: interpolate(s.body, values) };
}
