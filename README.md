# Status Page

Plataforma de status page self-hosted, inspirada no Atlassian Statuspage, com identidade
visual personalizável, notificações multicanal e login local ou LDAP/AD com MFA opcional.

O escopo completo, as decisões e as fases estão em [docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md).

> **Estado atual: F1 (núcleo).** Página pública com componentes, incidentes, manutenções e
> barra de disponibilidade de 90 dias; painel administrativo com login local, papéis e
> auditoria. Personalização visual, LDAP/MFA, notificações e monitoramento chegam nas
> próximas fases.

## O que já funciona

- **Página pública** (`/` e `/p/<endereço>`): status geral, componentes por grupo, barra de
  disponibilidade de 90 dias, incidentes ativos, manutenções, incidentes dos últimos 14 dias,
  histórico mensal e páginas de detalhe. Em pt-BR, en-US e es, com horários no fuso do visitante.
- **Painel** (`/admin`):
  - várias páginas de status por instalação; a primeira criada é exibida na raiz do site;
  - componentes e grupos (ordem, grupo recolhido, componente exibido em mais de uma página);
  - incidentes com linha do tempo, templates e registro retroativo;
  - manutenções com início e fim automáticos no horário (ou manuais);
  - equipe por página com papéis Leitor, Operador e Admin; usuários e Donos;
  - log de auditoria com filtros e exportação CSV; sessões ativas e troca de senha.
- **Segurança de login**: senhas com argon2id, política de senha, bloqueio progressivo após
  5 falhas (por conta e por IP), limite de requisições, cookie `HttpOnly`/`SameSite` e
  proteção CSRF por cabeçalho.

### Papéis

| Papel    | Pode                                                                      |
| -------- | ------------------------------------------------------------------------- |
| Leitor   | Ver o painel da página                                                    |
| Operador | Abrir e atualizar incidentes e manutenções; mudar o status de componentes |
| Admin    | Tudo do Operador + componentes, templates, equipe e configurações         |
| Dono     | Tudo em todas as páginas + usuários, criação e exclusão de páginas        |

## Instalação on-premise (Docker)

Requisitos: Docker Engine com o plugin Compose.

```bash
cp .env.example .env
# Preencha POSTGRES_PASSWORD, APP_SECRET e SEED_OWNER_PASSWORD (instruções no arquivo)
docker compose up -d --build --wait
```

A página fica em `http://<servidor>/`. Para HTTPS automático, defina `SITE_ADDRESS` com o
domínio público no `.env` (as portas 80 e 443 precisam estar acessíveis).

O serviço `migrate` aplica as migrações do banco e cria a conta Dono a cada start; ambos
são idempotentes. Entre em `http://<servidor>/admin` com `SEED_OWNER_EMAIL` e
`SEED_OWNER_PASSWORD` e crie a primeira página.

Atrás de um proxy corporativo com inspeção TLS, informe a CA no build:

```bash
docker build --secret id=extra_ca,src=/caminho/ca.crt -f docker/Dockerfile ...
```

### Serviços

| Serviço    | Função                                                        |
| ---------- | ------------------------------------------------------------- |
| `proxy`    | Caddy: ponto de entrada HTTP/HTTPS, encaminha `/api` e o site |
| `web`      | Next.js: página pública e painel (pt-BR, en-US, es)           |
| `api`      | NestJS: API REST (`/api/healthz`, `/api/readyz`)              |
| `worker`   | Filas BullMQ: notificações e tarefas agendadas                |
| `monitor`  | Checagens de disponibilidade (a partir da F5)                 |
| `migrate`  | Migrações do banco + seed; executa e termina                  |
| `postgres` | Banco de dados                                                |
| `redis`    | Filas, cache e limites de requisição                          |

## Desenvolvimento

Requisitos: Node.js 24 (ver `.nvmrc`), pnpm 10 e Docker.

```bash
pnpm install
pnpm infra:up                      # PostgreSQL, Redis e Mailpit (http://localhost:8025)
cp .env.example .env               # descomente DATABASE_URL e REDIS_URL e preencha APP_SECRET
pnpm build                         # gera o client do Prisma e compila os pacotes
pnpm db:deploy && pnpm db:seed     # aplica migrações e cria a conta Dono
pnpm dev                           # web em :3000, api em :3001
```

| Comando                        | O que faz                                    |
| ------------------------------ | -------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` | ESLint e TypeScript em todo o monorepo       |
| `pnpm test`                    | Testes (a API precisa de PostgreSQL e Redis) |
| `pnpm format`                  | Prettier                                     |
| `pnpm db:migrate`              | Cria uma nova migração a partir do schema    |

Os testes da API criam e usam o banco `status_test` (apagado a cada execução) e o índice 15
do Redis; ajuste com `TEST_DATABASE_URL` e `TEST_REDIS_URL` se necessário.

### Estrutura

```
apps/
  api/        NestJS
  web/        Next.js (página pública + painel)
  worker/     consumidores BullMQ
  monitor/    checagens de disponibilidade
packages/
  db/         schema Prisma, migrações, client e seed
  config/     validação de variáveis de ambiente e logger
  core/       regras de domínio compartilhadas (status, manutenções, uptime, auditoria)
  shared/     tipos, constantes e schemas de validação (status, papéis, idiomas)
  i18n/       traduções pt-BR, en-US e es
  runtime/    healthcheck HTTP e desligamento gracioso para worker/monitor
docker/       Dockerfile e Caddyfile
```

## Licença

[GPL-3.0](LICENSE)
