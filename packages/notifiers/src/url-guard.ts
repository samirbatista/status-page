import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ipInCidrs } from '@status-page/core';
import { SUBSCRIBER_WEBHOOK_HOSTS, type WEBHOOK_SUBSCRIBER_KINDS } from '@status-page/shared';
import { NotifierError } from './types.js';

/** Redes que nunca recebem webhooks de assinantes (SSRF). */
const BLOCKED_NETWORKS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

export type WebhookSubscriberKind = (typeof WEBHOOK_SUBSCRIBER_KINDS)[number];

function hostAllowed(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern,
  );
}

/**
 * Valida a URL de webhook informada por um assinante: HTTPS, domínio da lista
 * do serviço (ou de `extraHosts`, para laboratório) e nenhum IP privado.
 * Lança `NotifierError` (não repetível) com o motivo.
 */
export async function assertSubscriberWebhook(
  kind: WebhookSubscriberKind,
  rawUrl: string,
  options: { extraHosts?: string[]; resolve?: (host: string) => Promise<string[]> } = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NotifierError('invalid_url', false);
  }
  const extra = options.extraHosts ?? [];
  const host = url.hostname.toLowerCase();
  const lab = hostAllowed(host, extra);
  if (url.protocol !== 'https:' && !lab) throw new NotifierError('https_required', false);
  if (url.username || url.password) throw new NotifierError('invalid_url', false);
  if (!lab && !hostAllowed(host, SUBSCRIBER_WEBHOOK_HOSTS[kind])) {
    throw new NotifierError('host_not_allowed', false);
  }
  if (lab) return;
  if (isIP(host)) throw new NotifierError('host_not_allowed', false);
  const resolve =
    options.resolve ??
    (async (h: string) => (await lookup(h, { all: true })).map((r) => r.address));
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new NotifierError('host_not_found', true);
  }
  if (addresses.length === 0 || addresses.some((ip) => ipInCidrs(ip, BLOCKED_NETWORKS))) {
    throw new NotifierError('private_address', false);
  }
}
