import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { genericMappingSchema } from '@status-page/shared';
import { getPath, matchRule, parseInbound, verifyInboundSignature } from './inbound.js';

const mapping = genericMappingSchema.parse({});

describe('adaptadores de webhooks de entrada', () => {
  it('Alertmanager', () => {
    const alerts = parseInbound(
      'alertmanager',
      {
        status: 'firing',
        alerts: [
          {
            status: 'firing',
            fingerprint: 'abc',
            labels: { alertname: 'HighLatency', service: 'api' },
            annotations: { summary: 'p99 > 2s' },
          },
          { status: 'resolved', labels: { alertname: 'DiskFull', host: 'db1' } },
        ],
      },
      mapping,
    );
    expect(alerts).toEqual([
      {
        key: 'abc',
        name: 'HighLatency',
        labels: { alertname: 'HighLatency', service: 'api' },
        firing: true,
        summary: 'p99 > 2s',
      },
      {
        key: 'alertname=DiskFull,host=db1',
        name: 'DiskFull',
        labels: { alertname: 'DiskFull', host: 'db1' },
        firing: false,
        summary: '',
      },
    ]);
  });

  it('Grafana unificado e legado', () => {
    expect(
      parseInbound(
        'grafana',
        { alerts: [{ status: 'firing', fingerprint: 'f', labels: { alertname: 'X' } }] },
        mapping,
      )[0],
    ).toMatchObject({ key: 'f', firing: true });
    expect(parseInbound('grafana', { ruleId: 7, ruleName: 'CPU', state: 'ok' }, mapping)).toEqual([
      { key: '7', name: 'CPU', labels: {}, firing: false, summary: '' },
    ]);
    expect(parseInbound('grafana', { ruleId: 7, state: 'pending' }, mapping)).toEqual([]);
  });

  it('Zabbix com tags em lista', () => {
    const [alert] = parseInbound(
      'zabbix',
      {
        event_id: '123',
        name: 'Web down',
        host: 'web01',
        status: 'PROBLEM',
        severity: 'High',
        tags: [{ tag: 'service', value: 'site' }],
      },
      mapping,
    );
    expect(alert).toMatchObject({
      key: '123',
      firing: true,
      labels: { service: 'site', host: 'web01', severity: 'High' },
    });
    expect(
      parseInbound('zabbix', { event_id: '123', name: 'Web down', status: 'RESOLVED' }, mapping)[0]!
        .firing,
    ).toBe(false);
  });

  it('Uptime Kuma ignora mensagem de teste', () => {
    expect(parseInbound('uptime_kuma', { msg: 'teste' }, mapping)).toEqual([]);
    expect(
      parseInbound(
        'uptime_kuma',
        { heartbeat: { status: 0, msg: 'timeout' }, monitor: { id: 4, name: 'Site' } },
        mapping,
      )[0],
    ).toMatchObject({ key: '4', name: 'Site', firing: true, summary: 'timeout' });
  });

  it('JSON genérico com caminhos configuráveis', () => {
    const custom = genericMappingSchema.parse({
      itemsPath: 'data.events',
      keyPath: 'uid',
      namePath: 'check.name',
      statusPath: 'state',
      firingValues: ['CRIT'],
      labelsPath: 'tags',
    });
    expect(
      parseInbound(
        'generic',
        {
          data: {
            events: [{ uid: 'u1', check: { name: 'db' }, state: 'crit', tags: { env: 'prod' } }],
          },
        },
        custom,
      ),
    ).toEqual([{ key: 'u1', name: 'db', labels: { env: 'prod' }, firing: true, summary: '' }]);
    expect(getPath({ a: [{ b: 2 }] }, 'a.0.b')).toBe(2);
  });
});

describe('regras e assinatura', () => {
  const rules = [
    {
      id: '1',
      matchField: 'label:service',
      pattern: 'api',
      componentId: 'c-api',
      status: 'major_outage',
    },
    {
      id: '2',
      matchField: 'name',
      pattern: 'High*',
      componentId: 'c-x',
      status: 'degraded_performance',
    },
  ];
  it('a primeira regra que casa vale', () => {
    const alert = {
      key: 'k',
      name: 'HighLatency',
      labels: { service: 'api' },
      firing: true,
      summary: '',
    };
    expect(matchRule(rules, alert)?.id).toBe('1');
    expect(matchRule(rules, { ...alert, labels: {} })?.id).toBe('2');
    expect(matchRule(rules, { ...alert, name: 'Other', labels: {} })).toBeUndefined();
  });

  it('HMAC do corpo', () => {
    const body = Buffer.from('{"a":1}');
    const sig = createHmac('sha256', 's3').update(body).digest('hex');
    expect(verifyInboundSignature('s3', body, `sha256=${sig}`)).toBe(true);
    expect(verifyInboundSignature('s3', body, sig)).toBe(true);
    expect(verifyInboundSignature('outro', body, sig)).toBe(false);
    expect(verifyInboundSignature('s3', body, undefined)).toBe(false);
  });
});
