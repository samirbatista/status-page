# Status Page

Plataforma de status page self-hosted, inspirada no Atlassian Statuspage, com identidade
visual personalizável, notificações multicanal e login local ou LDAP/AD com MFA opcional.

O escopo completo, as decisões e as fases estão em [docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md).

> **Versão 1.0.0.** Todo o escopo do planejamento está implementado (F0–F6). Instalação
> a partir das imagens publicadas: [docs/INSTALACAO.md](docs/INSTALACAO.md). Mudanças em
> [CHANGELOG.md](CHANGELOG.md).

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
- **Aparência por página** (Painel → Aparência): logo (claro e escuro), favicon, imagem de
  cabeçalho e de compartilhamento, paletas clara e escura, cores dos status, tema
  claro/escuro/automático, fonte (sistema, Google Fonts ou arquivo próprio), estilo do
  cabeçalho, textos e links do rodapé, CSS e HTML personalizados. Rascunho com
  pré-visualização ao vivo e publicação.
- **Domínios próprios** (Painel → Configurações): cada página pode ter seus domínios,
  verificados por registro DNS TXT (ou manualmente pelo Dono, para redes internas). Domínios
  verificados recebem HTTPS automático no primeiro acesso.
- **Páginas privadas**: acesso por login (usuários com papel na página), por redes liberadas
  (CIDR) ou pela combinação das duas.
- **Login corporativo** (Painel → Autenticação): provedores Active Directory e OpenLDAP
  (LDAPS ou StartTLS, CA própria), testes de conexão e de login, usuário criado no
  primeiro login, grupos (inclusive aninhados) mapeados para papéis e sincronização
  periódica: conta desativada no diretório perde o acesso. Guia em
  [docs/AUTENTICACAO.md](docs/AUTENTICACAO.md).
- **MFA**: aplicativo autenticador (TOTP), chaves de segurança e passkeys (WebAuthn) e
  códigos de recuperação; política opcional, por papel ou para todos; redefinição pelo
  Dono ou Admin. **Conta de emergência** local que entra mesmo com o LDAP fora do ar.
- **Notificações** (Página → Notificações; guia em [docs/NOTIFICACOES.md](docs/NOTIFICACOES.md)):
  canais da equipe por e-mail (SMTP), Telegram, Slack, Discord, Microsoft Teams (Workflows),
  Google Chat, WhatsApp (Cloud API) e webhook genérico assinado com HMAC; mensagens
  personalizáveis por canal, evento e idioma; fila com novas tentativas e registro de cada
  entrega com reenvio; lembrete 24 h antes das manutenções.
- **Assinantes**: inscrição pública por e-mail (com **código de confirmação obrigatório**),
  WhatsApp, Telegram, Slack, Discord, Teams e Google Chat, escolhendo componentes, eventos e
  idioma; link de gerenciar e cancelar em toda mensagem; consentimento registrado e exclusão
  dos dados (LGPD); importação com convite e exportação em CSV.
- **Monitoramento** (Página → Monitores; guia em [docs/MONITORAMENTO.md](docs/MONITORAMENTO.md)):
  checagens HTTP(S), TCP, ping, DNS e certificado SSL com limites de falha e normalização.
  No modo **automático** o status do componente muda sozinho (e um incidente é aberto a partir
  de um template); no modo **sugestão** o Operador confirma. Ao normalizar, o status anterior
  volta e o incidente é resolvido; os assinantes são avisados.
- **Integrações** (Página → Integrações): webhooks de entrada para Prometheus Alertmanager,
  Grafana, Zabbix, Uptime Kuma e JSON genérico, com URL secreta, HMAC opcional e regras por
  nome ou rótulo do alerta.
- **Métricas públicas** (`/p/<endereço>/metrics`): latência e disponibilidade em 24 h, 7 e
  30 dias dos monitores marcados como públicos.
- **Postmortem** em Markdown no incidente, publicado na página pública e notificado aos
  assinantes.
- **API e distribuição** (Página → API e incorporação; guia em [docs/API.md](docs/API.md)):
  tokens de API por página com papel e validade, documentação OpenAPI em `/api/docs`,
  `status.json`, feeds RSS/Atom, selo SVG, widget (script ou iframe) e webhooks de saída
  por evento.
- **Exportar e importar** (Dono): configuração completa em JSON, com segredos cifrados por
  senha, pré-visualização e modos mesclar/substituir. Backup completo e restauração com
  `scripts/backup.sh` e `scripts/restore.sh`.
- **Segurança de login**: senhas com argon2id, política de senha, bloqueio progressivo após
  5 falhas (por conta e por IP), limite de requisições, cookie `HttpOnly`/`SameSite` e
  proteção CSRF por cabeçalho.

### Papéis

| Papel    | Pode                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Leitor   | Ver o painel da página                                                                                           |
| Operador | Abrir e atualizar incidentes e manutenções; mudar o status de componentes; aceitar alertas sugeridos; postmortem |
| Admin    | Tudo do Operador + componentes, templates, monitores, integrações, equipe e configurações                        |
| Dono     | Tudo em todas as páginas + usuários, páginas, LDAP e política de MFA                                             |

## Instalação on-premise (Docker)

Guia completo (instalação do zero, atualização, backup e restauração):
[docs/INSTALACAO.md](docs/INSTALACAO.md).

Requisitos: Docker Engine com o plugin Compose.

```bash
cp .env.example .env
# Preencha POSTGRES_PASSWORD, APP_SECRET e SEED_OWNER_PASSWORD (instruções no arquivo)
docker compose pull && docker compose up -d --no-build --wait   # imagens publicadas
# ou, compilando do código: IMAGE_PREFIX=status-page no .env e docker compose up -d --build --wait
```

A página fica em `http://<servidor>/`. Para HTTPS automático, defina `SITE_ADDRESS` com o
domínio público no `.env` (as portas 80 e 443 precisam estar acessíveis).

Arquivos enviados (logos, fontes) ficam no volume `uploads-data` da API.

### Domínios próprios

1. Aponte o DNS do domínio (registro A/AAAA ou CNAME) para o servidor.
2. Em Painel → Configurações da página, adicione o domínio e crie o registro TXT indicado.
3. Clique em **Verificar**. A partir daí o Caddy emite o certificado no primeiro acesso
   (`on_demand_tls`, liberado apenas para domínios verificados).

Em redes internas sem DNS público, o Dono pode marcar o domínio como verificado; com
`SITE_ADDRESS` vazio, os domínios também são atendidos por HTTP na porta 80.

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
| `monitor`  | Checagens dos monitores e automação de status                 |
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
  core/       regras de domínio compartilhadas (status, manutenções, uptime, auditoria,
              checagens, automação e webhooks de entrada)
  shared/     tipos, constantes e schemas de validação (status, papéis, idiomas)
  i18n/       traduções pt-BR, en-US e es
  runtime/    healthcheck HTTP e desligamento gracioso para worker/monitor
docker/       Dockerfile e Caddyfile
```

## Licença

[GPL-3.0](LICENSE)
