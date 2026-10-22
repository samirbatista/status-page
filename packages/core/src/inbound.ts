import { createHmac, timingSafeEqual } from 'node:crypto';
import { type GenericMapping, globMatch, type InboundKind } from '@status-page/shared';

/**
 * Webhooks de entrada: cada adaptador transforma o payload da ferramenta em
 * alertas normalizados (em falha ou normalizado), que as regras ligam a um
 * componente e a um status.
 */

export interface InboundAlert {
  /** Identificador estável: o mesmo no disparo e na normalização. */
  key: string;
  name: string;
  labels: Record<string, string>;
  firing: boolean;
  summary: string;
}

export interface RuleLike {
  id: string;
  matchField: string;
  pattern: string;
  componentId: string;
  status: string;
}

type Json = Record<string, unknown>;

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function obj(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(obj(value)).map(([k, v]) => [k, str(v)]));
}

/** Lê `a.b.0.c` de um objeto. */
export function getPath(source: unknown, path: string): unknown {
  if (!path) return source;
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = Array.isArray(current) ? current[Number(part)] : (current as Json)[part];
  }
  return current;
}

/** Chave a partir dos rótulos, quando a ferramenta não manda um identificador. */
function labelsKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

/** Alertmanager e o alerting unificado do Grafana usam o mesmo formato. */
function alertmanager(body: Json): InboundAlert[] {
  const alerts = Array.isArray(body.alerts) ? body.alerts : [];
  return alerts.map((raw) => {
    const alert = obj(raw);
    const labels = stringMap(alert.labels);
    const annotations = stringMap(alert.annotations);
    return {
      key: str(alert.fingerprint) || labelsKey(labels),
      name: labels.alertname ?? str(alert.title) ?? 'alert',
      labels,
      firing: str(alert.status).toLowerCase() === 'firing',
      summary: annotations.summary ?? annotations.description ?? str(body.title),
    };
  });
}

function grafana(body: Json): InboundAlert[] {
  if (Array.isArray(body.alerts)) return alertmanager(body);
  // Alertas legados do Grafana (state: alerting | ok | no_data | pending).
  const state = str(body.state).toLowerCase();
  if (state === 'pending') return [];
  return [
    {
      key: str(body.ruleId) || str(body.ruleName),
      name: str(body.ruleName) || 'grafana',
      labels: stringMap(body.tags),
      firing: state === 'alerting' || state === 'no_data',
      summary: str(body.message) || str(body.title),
    },
  ];
}

/**
 * Zabbix (media type webhook): o script sugerido na documentação envia
 * event_id, name, host, status (PROBLEM/RESOLVED), severity e tags.
 */
function zabbix(body: Json): InboundAlert[] {
  const tags = Array.isArray(body.tags)
    ? Object.fromEntries((body.tags as unknown[]).map((t) => [str(obj(t).tag), str(obj(t).value)]))
    : stringMap(body.tags);
  const status = str(body.status).toUpperCase();
  const value = str(body.event_value);
  const name = str(body.name) || str(body.trigger_name) || str(body.event_name) || 'zabbix';
  const host = str(body.host);
  return [
    {
      key: str(body.event_id) || str(body.trigger_id) || `${host}:${name}`,
      name,
      labels: { ...tags, host, severity: str(body.severity) },
      firing: status ? status === 'PROBLEM' : value === '1',
      summary: str(body.message) || name,
    },
  ];
}

/** Uptime Kuma: heartbeat.status 0 = fora, 1 = no ar; mensagens de teste vêm sem heartbeat. */
function uptimeKuma(body: Json): InboundAlert[] {
  const heartbeat = body.heartbeat ? obj(body.heartbeat) : null;
  if (!heartbeat) return [];
  const status = Number(heartbeat.status);
  if (status !== 0 && status !== 1) return [];
  const monitor = obj(body.monitor);
  const name = str(monitor.name) || 'uptime-kuma';
  return [
    {
      key: str(monitor.id) || name,
      name,
      labels: { url: str(monitor.url), hostname: str(monitor.hostname), type: str(monitor.type) },
      firing: status === 0,
      summary: str(heartbeat.msg) || str(body.msg),
    },
  ];
}

function generic(body: unknown, mapping: GenericMapping): InboundAlert[] {
  const items = mapping.itemsPath ? getPath(body, mapping.itemsPath) : body;
  const list = Array.isArray(items) ? items : [items];
  const firingValues = new Set(mapping.firingValues.map((v) => v.toLowerCase()));
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const name = str(getPath(item, mapping.namePath)) || 'alert';
      const labels = stringMap(getPath(item, mapping.labelsPath));
      return {
        key: str(getPath(item, mapping.keyPath)) || name,
        name,
        labels,
        firing: firingValues.has(str(getPath(item, mapping.statusPath)).toLowerCase()),
        summary: str(getPath(item, mapping.summaryPath)),
      };
    });
}

export function parseInbound(
  kind: InboundKind,
  body: unknown,
  mapping: GenericMapping,
): InboundAlert[] {
  const json = obj(body);
  switch (kind) {
    case 'alertmanager':
      return alertmanager(json);
    case 'grafana':
      return grafana(json);
    case 'zabbix':
      return zabbix(json);
    case 'uptime_kuma':
      return uptimeKuma(json);
    case 'generic':
      return generic(body, mapping);
  }
}

/** Primeira regra (na ordem) cujo campo casa com o padrão. */
export function matchRule<R extends RuleLike>(rules: R[], alert: InboundAlert): R | undefined {
  return rules.find((rule) => {
    const value =
      rule.matchField === 'name'
        ? alert.name
        : (alert.labels[rule.matchField.replace(/^label:/, '')] ?? '');
    return globMatch(rule.pattern, value);
  });
}

/** Confere `X-Signature: sha256=<hex>` (ou só o hex) contra o HMAC-SHA256 do corpo. */
export function verifyInboundSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const given = header
    .replace(/^sha256=/i, '')
    .trim()
    .toLowerCase();
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}
