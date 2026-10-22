import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { NOTIFICATION_EVENT_TYPES } from '@status-page/shared';

/**
 * Documentação OpenAPI 3.1 da API pública (leitura) e administrativa (tokens).
 * Só entram as rotas que um token alcança: `/api/public/*`, `/api/hooks/*` e as
 * rotas de página (`/api/pages/{pageId}/...`). Rotas de sessão (login, MFA,
 * perfil) e de Dono ficam de fora.
 */

const DOCUMENTED = /^\/api\/(public|hooks|pages\/\{pageId\})(\/|$)/;

const TAG_NAMES: Record<string, string> = {
  public: 'Pública',
  hooks: 'Webhooks de entrada',
};

function tagFor(path: string): string {
  const parts = path.split('/').filter(Boolean); // api, pages, {pageId}, incidents...
  if (parts[1] === 'pages') return parts[3] ?? 'pages';
  return TAG_NAMES[parts[1]!] ?? parts[1]!;
}

const webhookPayload = {
  type: 'object',
  required: ['event', 'subject', 'text', 'url', 'data', 'sentAt'],
  properties: {
    event: { type: 'string', enum: [...NOTIFICATION_EVENT_TYPES] },
    subject: { type: 'string', description: 'Assunto já renderizado no idioma do canal.' },
    text: { type: 'string', description: 'Mensagem já renderizada.' },
    url: { type: 'string', format: 'uri', description: 'Link para o detalhe na página pública.' },
    data: {
      type: 'object',
      description:
        'Retrato do evento: `type`, `page` (slug, nome), `incident` ou `maintenance` (quando houver), ' +
        '`update` e `components` (id, nome e status).',
    },
    sentAt: { type: 'string', format: 'date-time' },
  },
};

export function buildOpenApi(app: INestApplication, version: string): OpenAPIObject {
  const config = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle('Status Page API')
    .setVersion(version)
    .setDescription(
      [
        'API REST da Status Page.',
        '',
        '- **Pública** (`/api/public`): leitura de status, componentes, incidentes, manutenções e métricas. ' +
          'Páginas privadas seguem a mesma regra de acesso da página (login, IP ou token com papel na página).',
        '- **Administrativa** (`/api/pages/{pageId}/...`): exige um token criado em Painel → Configurações → Tokens de API, ' +
          'enviado como `Authorization: Bearer sp_...`. O token vale para uma página, com o papel escolhido ' +
          '(Leitor, Operador ou Admin), e age em nome de quem o criou.',
        '- **Webhooks de saída**: canais do tipo "Webhook genérico" recebem os eventos assinados com ' +
          '`X-StatusPage-Signature: sha256=<hmac>` sobre `<timestamp>.<corpo>` (cabeçalho `X-StatusPage-Timestamp`).',
      ].join('\n'),
    )
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'sp_...' }, 'token')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const paths: OpenAPIObject['paths'] = {};
  for (const [path, item] of Object.entries(document.paths)) {
    // Rotas de sessão e de Dono já saem do documento (@SessionOnly/@RequireOwner).
    if (!DOCUMENTED.test(path)) continue;
    const admin = path.startsWith('/api/pages/');
    for (const op of Object.values(item) as { tags?: string[]; security?: unknown[] }[]) {
      if (typeof op !== 'object' || op === null) continue;
      op.tags = [tagFor(path)];
      if (admin) op.security = [{ token: [] }];
    }
    paths[path] = item;
  }
  document.paths = paths;
  (document as OpenAPIObject & { webhooks?: unknown }).webhooks = {
    notificationEvent: {
      post: {
        summary: 'Evento enviado aos canais "Webhook genérico"',
        description:
          'Responda com 2xx. Falhas temporárias (5xx, timeout) são repetidas até 7 vezes com espera exponencial.',
        parameters: [
          { name: 'X-StatusPage-Event', in: 'header', schema: { type: 'string' } },
          { name: 'X-StatusPage-Timestamp', in: 'header', schema: { type: 'string' } },
          {
            name: 'X-StatusPage-Signature',
            in: 'header',
            schema: { type: 'string' },
            description:
              'sha256=<hex> do HMAC-SHA256 de `<timestamp>.<corpo>` com o segredo do canal.',
          },
        ],
        requestBody: { content: { 'application/json': { schema: webhookPayload } } },
        responses: { '200': { description: 'Recebido' } },
      },
    },
  };
  return document;
}

/** Interface Swagger em `/api/docs` e o JSON em `/api/docs/openapi.json`. */
export function setupApiDocs(app: INestApplication, version: string): void {
  const document = buildOpenApi(app, version);
  SwaggerModule.setup('api/docs', app, document, {
    useGlobalPrefix: false,
    jsonDocumentUrl: 'api/docs/openapi.json',
    customSiteTitle: 'Status Page API',
    swaggerOptions: { persistAuthorization: false },
  });
}
