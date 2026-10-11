import { createServer, type Server } from 'node:http';

export type ReadinessCheck = () => Promise<void>;

/**
 * Servidor HTTP mínimo para os healthchecks de serviços sem API própria
 * (worker e monitor): `/healthz` (processo vivo) e `/readyz` (dependências ok).
 */
export function startHealthServer(port: number, readiness: ReadinessCheck): Promise<Server> {
  const server = createServer((req, res) => {
    const reply = (status: number, body: object) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.url === '/healthz') return reply(200, { status: 'ok' });
    if (req.url === '/readyz') {
      readiness().then(
        () => reply(200, { status: 'ok' }),
        () => reply(503, { status: 'error' }),
      );
      return;
    }
    reply(404, { status: 'not_found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

/** Executa `cleanup` uma única vez ao receber SIGTERM/SIGINT e encerra o processo. */
export function onShutdown(cleanup: () => Promise<void>, log: (msg: string) => void): void {
  let shuttingDown = false;
  const handler = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} recebido; encerrando`);
    cleanup().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}
