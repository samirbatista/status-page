import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from 'node:http';
import {
  createServer as createTcpServer,
  type AddressInfo,
  type Server as TcpServer,
} from 'node:net';

/** Servidor SMTP mínimo que guarda as mensagens recebidas (sem TLS nem autenticação). */
export class FakeSmtp {
  readonly messages: { from: string; to: string[]; data: string }[] = [];
  private server: TcpServer | null = null;
  port = 0;

  async start(): Promise<void> {
    this.server = createTcpServer((socket) => {
      let buffer = '';
      let inData = false;
      let current = { from: '', to: [] as string[], data: '' };
      socket.write('220 fake-smtp ESMTP\r\n');
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              this.messages.push(current);
              current = { from: '', to: [], data: '' };
              socket.write('250 OK queued\r\n');
            } else current.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
            continue;
          }
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-fake-smtp\r\n250 8BITMIME\r\n');
          else if (cmd === 'MAIL') {
            current.from = /<(.*)>/.exec(line)?.[1] ?? '';
            socket.write('250 OK\r\n');
          } else if (cmd === 'RCPT') {
            current.to.push(/<(.*)>/.exec(line)?.[1] ?? '');
            socket.write('250 OK\r\n');
          } else if (cmd === 'DATA') {
            inData = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (cmd === 'QUIT') {
            socket.end('221 Bye\r\n');
          } else socket.write('250 OK\r\n');
        }
      });
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server!.address() as AddressInfo).port;
  }

  /** Último e-mail para o endereço, já decodificado (quoted-printable simples). */
  lastTo(address: string): string | undefined {
    const msg = [...this.messages].reverse().find((m) => m.to.includes(address));
    return msg?.data
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }
}

export interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * Servidor HTTP que responde como as APIs do Telegram e do WhatsApp e como
 * webhooks (Slack, Discord, Teams, Google Chat, genérico). Guarda as requisições.
 */
export class FakeHttp {
  readonly requests: CapturedRequest[] = [];
  /** Status forçado por prefixo de caminho (ex.: { '/flaky': 503 }). */
  readonly statusFor = new Map<string, number>();
  private server: Server | null = null;
  base = '';

  async start(): Promise<void> {
    this.server = createHttpServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = req.url ?? '';
        this.requests.push({ method: req.method ?? '', url, headers: req.headers, body });
        const forced = [...this.statusFor].find(([prefix]) => url.startsWith(prefix))?.[1];
        res.writeHead(forced ?? 200, { 'Content-Type': 'application/json' });
        if (url.includes('/getMe')) res.end('{"ok":true,"result":{"username":"status_test_bot"}}');
        else if (url.includes('/getUpdates')) res.end('{"ok":true,"result":[]}');
        else if (/\/bot[^/]+\//.test(url)) res.end('{"ok":true,"result":{}}');
        else res.end('{}');
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  /** Mesmo servidor, pelo nome `localhost` (liberado em WEBHOOK_EXTRA_HOSTS nos testes). */
  get localhostBase(): string {
    return this.base.replace('127.0.0.1', 'localhost');
  }

  to(prefix: string): CapturedRequest[] {
    return this.requests.filter((r) => r.url.startsWith(prefix));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }
}
