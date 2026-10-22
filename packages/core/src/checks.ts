import { spawn } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { connect as netConnect, isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { type MonitorType, statusMatcher } from '@status-page/shared';
import { Agent, fetch } from 'undici';

/** Checagens dos monitores: HTTP(S), TCP, ICMP (ping), DNS e certificado SSL. */

export interface CheckInput {
  type: MonitorType;
  target: string;
  config: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs: number;
}

export interface CheckResult {
  ok: boolean;
  latencyMs: number | null;
  /** Motivo da falha (curto, para o painel e o alerta). */
  error: string | null;
  /** Informação extra no sucesso (ex.: dias até o certificado vencer). */
  detail?: string;
}

const MAX_BODY_BYTES = 1_000_000;

function fail(error: string, latencyMs: number | null = null): CheckResult {
  return { ok: false, latencyMs, error: error.slice(0, 300) };
}

function describe(error: unknown): string {
  const err = error as {
    code?: string;
    cause?: { code?: string; message?: string };
    message?: string;
    name?: string;
  };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  return err?.cause?.code ?? err?.code ?? err?.cause?.message ?? err?.message ?? String(error);
}

export async function checkHttp(input: CheckInput): Promise<CheckResult> {
  const config = input.config as {
    method?: string;
    expectedStatus?: string;
    keyword?: string;
    keywordAbsent?: boolean;
    followRedirects?: boolean;
    verifyTls?: boolean;
    body?: string;
  };
  const dispatcher = new Agent({
    connect: { rejectUnauthorized: config.verifyTls !== false, timeout: input.timeoutMs },
  });
  const started = performance.now();
  try {
    const res = await fetch(input.target, {
      method: config.method ?? 'GET',
      headers: { 'User-Agent': 'StatusPage-Monitor/1', ...input.headers },
      body: config.method === 'POST' && config.body ? config.body : undefined,
      redirect: config.followRedirects === false ? 'manual' : 'follow',
      signal: AbortSignal.timeout(input.timeoutMs),
      dispatcher,
    });
    let text = '';
    if (config.keyword) {
      const reader = res.body?.getReader();
      let size = 0;
      const decoder = new TextDecoder();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        text += decoder.decode(value, { stream: true });
        if (size >= MAX_BODY_BYTES) {
          await reader.cancel();
          break;
        }
      }
    } else {
      await res.body?.cancel();
    }
    const latencyMs = Math.round(performance.now() - started);
    if (!statusMatcher(config.expectedStatus ?? '200-399')(res.status)) {
      return fail(`HTTP ${res.status}`, latencyMs);
    }
    if (config.keyword) {
      const found = text.toLowerCase().includes(config.keyword.toLowerCase());
      if (found === Boolean(config.keywordAbsent)) {
        return fail(config.keywordAbsent ? 'keyword_present' : 'keyword_missing', latencyMs);
      }
    }
    return { ok: true, latencyMs, error: null, detail: `HTTP ${res.status}` };
  } catch (error) {
    return fail(describe(error), Math.round(performance.now() - started));
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}

export function checkTcp(input: CheckInput): Promise<CheckResult> {
  const port = Number((input.config as { port?: number }).port);
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = netConnect({ host: input.target, port, timeout: input.timeoutMs });
    const done = (result: CheckResult) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () =>
      done({ ok: true, latencyMs: Math.round(performance.now() - started), error: null }),
    );
    socket.once('timeout', () => done(fail('timeout', input.timeoutMs)));
    socket.once('error', (err) =>
      done(fail(describe(err), Math.round(performance.now() - started))),
    );
  });
}

/** Ping pelo binário do sistema (o container do monitor tem iputils-ping). */
export function checkIcmp(input: CheckInput): Promise<CheckResult> {
  const seconds = Math.max(1, Math.ceil(input.timeoutMs / 1000));
  const family = isIP(input.target) === 6 ? ['-6'] : [];
  return new Promise((resolve) => {
    let output = '';
    let child;
    try {
      child = spawn('ping', [...family, '-c', '1', '-n', '-W', String(seconds), input.target], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve(fail('ping_unavailable'));
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), input.timeoutMs + 2000);
    child.stdout.on('data', (c: Buffer) => (output += c.toString()));
    child.stderr.on('data', (c: Buffer) => (output += c.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(fail('ping_unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const time = /time[=<]([\d.]+)\s*ms/.exec(output);
      if (code === 0 && time) {
        resolve({ ok: true, latencyMs: Math.round(Number(time[1])), error: null });
      } else {
        const reason = /unknown host|Name or service not known|not known/i.test(output)
          ? 'host_not_found'
          : 'no_reply';
        resolve(fail(reason));
      }
    });
  });
}

export async function checkDns(input: CheckInput): Promise<CheckResult> {
  const config = input.config as { recordType?: string; expected?: string; server?: string };
  const resolver = new Resolver({ timeout: input.timeoutMs, tries: 1 });
  if (config.server) resolver.setServers([config.server]);
  const type = config.recordType ?? 'A';
  const started = performance.now();
  try {
    let answers: string[];
    switch (type) {
      case 'AAAA':
        answers = await resolver.resolve6(input.target);
        break;
      case 'CNAME':
        answers = await resolver.resolveCname(input.target);
        break;
      case 'MX':
        answers = (await resolver.resolveMx(input.target)).map((r) => r.exchange);
        break;
      case 'TXT':
        answers = (await resolver.resolveTxt(input.target)).map((r) => r.join(''));
        break;
      case 'NS':
        answers = await resolver.resolveNs(input.target);
        break;
      default:
        answers = await resolver.resolve4(input.target);
    }
    const latencyMs = Math.round(performance.now() - started);
    const expected = config.expected?.trim().toLowerCase().replace(/\.$/, '');
    if (expected && !answers.some((a) => a.toLowerCase().replace(/\.$/, '').includes(expected))) {
      return fail(`unexpected_answer: ${answers.join(', ').slice(0, 200)}`, latencyMs);
    }
    return { ok: true, latencyMs, error: null, detail: answers.join(', ').slice(0, 200) };
  } catch (error) {
    return fail(describe(error), Math.round(performance.now() - started));
  } finally {
    resolver.cancel();
  }
}

/** Certificado: cadeia válida para o nome e dias até o vencimento. */
export function checkSsl(input: CheckInput): Promise<CheckResult> {
  const config = input.config as { port?: number; minDaysLeft?: number };
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = tlsConnect({
      host: input.target,
      port: config.port ?? 443,
      servername: isIP(input.target) ? undefined : input.target,
      rejectUnauthorized: false,
      timeout: input.timeoutMs,
    });
    const done = (result: CheckResult) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('secureConnect', () => {
      const latencyMs = Math.round(performance.now() - started);
      const cert = socket.getPeerCertificate();
      if (!cert?.valid_to) return done(fail('no_certificate', latencyMs));
      const daysLeft = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
      if (!socket.authorized) {
        return done(fail(`invalid_certificate: ${socket.authorizationError}`, latencyMs));
      }
      if (daysLeft < (config.minDaysLeft ?? 14)) {
        return done(fail(`expires_in_days: ${daysLeft}`, latencyMs));
      }
      done({ ok: true, latencyMs, error: null, detail: `days_left: ${daysLeft}` });
    });
    socket.once('timeout', () => done(fail('timeout', input.timeoutMs)));
    socket.once('error', (err) =>
      done(fail(describe(err), Math.round(performance.now() - started))),
    );
  });
}

export async function runCheck(input: CheckInput): Promise<CheckResult> {
  switch (input.type) {
    case 'http':
      return checkHttp(input);
    case 'tcp':
      return checkTcp(input);
    case 'icmp':
      return checkIcmp(input);
    case 'dns':
      return checkDns(input);
    case 'ssl':
      return checkSsl(input);
  }
}
