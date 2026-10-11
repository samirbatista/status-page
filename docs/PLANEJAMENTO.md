# Planejamento — Status Page

Plataforma de status page self-hosted, inspirada no Atlassian Statuspage, com identidade visual totalmente personalizável, notificações multicanal, autenticação local ou LDAP/AD e MFA opcional.

- **Hospedagem:** on-premise, via Docker Compose
- **Licença:** GPLv3 (mantida)
- **Idiomas:** pt-BR (padrão), en-US, es

---

## 1. Registro de decisões

| # | Decisão | Status |
|---|---|---|
| D1 | Stack: Node.js + TypeScript (NestJS) no backend, Next.js no frontend, PostgreSQL, Redis + BullMQ | Aprovado |
| D2 | Hospedagem on-premise com Docker Compose | Aprovado |
| D3 | WhatsApp somente pela API oficial da Meta (WhatsApp Cloud API) | Aprovado |
| D4 | Licença GPLv3 | Mantida |
| D5 | Monitoramento automático (HTTP, TCP, ICMP, DNS, SSL) | Incluído (sugestão 1) |
| D6 | Webhooks de entrada (Alertmanager, Grafana, Zabbix, Uptime Kuma, genérico) | Incluído (sugestão 2) |
| D7 | Templates de incidente e postmortem | Incluído (sugestão 3) |
| D8 | Métricas públicas (gráficos) | Incluído (sugestão 4) |
| D9 | Assinatura pública, com **validação obrigatória de e-mail por código** | Incluído (sugestão 5) |
| D10 | Canais adicionais: Microsoft Teams e Google Chat (webhook) | Incluído (sugestão 6) |
| D11 | RSS/Atom, API REST pública, webhooks de saída e widget | Incluído (sugestão 7) |
| D12 | Idiomas: apenas pt-BR, en-US e es | Incluído (sugestão 8) |
| D13 | Controle de acesso por papéis + mapeamento de grupos AD/LDAP | Incluído (sugestão 9) |
| D14 | MFA: TOTP + WebAuthn/passkeys + códigos de recuperação + política de obrigatoriedade | Incluído (sugestão 11) |
| D15 | Log de auditoria | Incluído (sugestão 12) |
| D16 | Proteções de login (bloqueio, limite de requisições, política de senha) | Incluído (sugestão 13) |
| D17 | Múltiplas status pages por instalação | Incluído (sugestão 14) |
| D18 | Página privada (login e/ou lista de IPs liberados) | Incluído (sugestão 15) |
| D19 | Exportar e importar configuração | Incluído (sugestão 16) |
| — | SSO via OIDC/SAML (sugestão 10) | **Fora do escopo** |
| — | SMS | **Fora do escopo** |

---

## 2. Escopo funcional

### 2.1 Página pública

- **Componentes e grupos de componentes.** Cada componente tem um destes status: `operational`, `degraded_performance`, `partial_outage`, `major_outage` ou `under_maintenance`. Os grupos podem ser recolhidos na tela.
- **Banner de status geral**, calculado pelo pior status entre os componentes visíveis.
- **Incidentes ativos** com linha do tempo: `investigating` → `identified` → `monitoring` → `resolved`. Cada atualização registra os componentes afetados e o status de cada um.
- **Manutenções programadas**, nos estados `scheduled` → `in_progress` → `completed`. A transição é automática pelo horário, com opção de manter manual.
- **Barra de disponibilidade de 90 dias** por componente. Ao passar o mouse, mostra o percentual do dia e os incidentes daquele dia.
- **Métricas públicas**: gráficos de latência e tempo de resposta por dia, semana e mês.
- **Histórico de incidentes**, paginado por mês, com página própria para cada incidente e o postmortem quando houver.
- **Formulário de assinatura** (ver seção 2.4).
- **Seletor de idioma** (pt-BR, en-US, es). Os horários aparecem no fuso do visitante.
- **Feeds RSS/Atom**, **widget incorporável** (script e iframe) e **endpoint JSON** de status.

### 2.2 Múltiplas páginas e página privada

- Uma instalação hospeda **várias status pages**. Cada página tem slug, domínio, tema, componentes, assinantes e equipe próprios.
- Um mesmo componente pode aparecer em mais de uma página, por exemplo na pública e na interna.
- Visibilidade de cada página:
  - **Pública**: aberta a qualquer visitante.
  - **Privada por login**: exige conta local ou LDAP com papel `Leitor` ou superior naquela página.
  - **Privada por IP**: aceita apenas a lista de CIDRs liberados.
  - **Combinação** das duas regras anteriores, com operador "E" ou "OU" configurável.
- Feeds, widget, API e assinatura de uma página privada seguem a mesma regra de acesso da página.

### 2.3 Personalização visual (por página)

- Logo (claro e escuro), favicon, imagem de cabeçalho e imagem de compartilhamento (Open Graph).
- Paleta: cor primária, fundo, texto, links e a cor de cada status.
- Fonte: Google Fonts ou upload de arquivo próprio.
- Tema claro, escuro ou automático.
- Layout: escolha entre modelos de cabeçalho, ordem das seções e exibição da barra de uptime e das métricas.
- Textos personalizados, rodapé, links personalizados e informações de contato/suporte.
- CSS personalizado e HTML de cabeçalho/rodapé, ambos sanitizados (ver seção 5).
- **Pré-visualização ao vivo** no editor, com versões publicadas e rascunho.
- **Domínio personalizado** com TLS automático.

### 2.4 Assinantes (público)

- O visitante se inscreve pelos canais **E-mail**, **Telegram**, **Slack**, **Discord**, **Microsoft Teams**, **Google Chat** ou **WhatsApp**, escolhendo:
  - os componentes de interesse (todos ou uma seleção);
  - os tipos de evento: incidentes, manutenções ou ambos;
  - o idioma das mensagens.
- **Validação de e-mail obrigatória por código**:
  1. O visitante informa o e-mail e os componentes.
  2. O sistema envia um **código numérico de 6 dígitos**, válido por **15 minutos**.
  3. O visitante digita o código na própria página. Sem essa etapa, a inscrição **não é ativada** e nenhum alerta é enviado.
  4. São permitidas no máximo **5 tentativas** por código. O reenvio só fica disponível após 60 segundos, com limite de 5 envios por hora por e-mail e por IP.
  5. Só o hash do código é armazenado. Inscrições não confirmadas são removidas após 24 horas.
- Validação dos outros canais:
  - **WhatsApp**: o número é confirmado por código enviado por um template oficial de autenticação. A aceitação é registrada, como a Meta exige.
  - **Telegram**: o visitante abre um link para o bot (`/start <token>`) e o vínculo é feito automaticamente.
  - **Slack, Discord, Teams e Google Chat**: o visitante informa a URL do webhook. O sistema envia uma mensagem de teste e valida a URL contra uma lista de domínios permitidos (proteção contra SSRF).
- Toda mensagem leva um **link de gerenciamento e de cancelamento** da inscrição.
- O consentimento é registrado (data, IP e texto aceito) para atender à LGPD, e o assinante pode excluir seus dados.
- O administrador pode importar e exportar assinantes em CSV. A importação não dispensa a confirmação por código: cada contato importado recebe um convite.

### 2.5 Canais da equipe (configurados pelo administrador)

São os destinos internos que recebem todos os eventos de uma página. Por exemplo: o canal `#incidentes` no Slack, um grupo no Telegram ou uma equipe no Teams.

| Canal | Integração |
|---|---|
| E-mail | SMTP configurável (host, porta, TLS, usuário, remetente) |
| WhatsApp | WhatsApp Cloud API (token, Phone Number ID e templates aprovados pela Meta) |
| Telegram | Bot API (token do bot e chat ID) |
| Slack | Incoming Webhook |
| Discord | Webhook |
| Microsoft Teams | Webhook de Workflows (Power Automate) com Adaptive Card |
| Google Chat | Webhook de espaço, com mensagem em formato Card |
| Webhook genérico | Requisição HTTP POST com JSON assinado por HMAC-SHA256 |

- **Templates de mensagem** por canal, tipo de evento e idioma, com variáveis (`{{incident.title}}`, `{{component.name}}`, `{{page.url}}`…).
- **Fila com novas tentativas** (backoff exponencial), limite de envio por canal e **registro de cada entrega** com status, erro e opção de reenviar.
- Botão "Enviar teste" em cada canal.

### 2.6 Incidentes, manutenções, templates e postmortem

- O incidente tem título, impacto (`none`, `minor`, `major`, `critical`), componentes afetados e atualizações.
- Cada atualização permite marcar se notifica ou não os assinantes, para evitar ruído em correções pequenas.
- **Templates de incidente**: título, corpo, componentes e status pré-preenchidos.
- **Postmortem**: editor Markdown, rascunho e publicação, com notificação opcional aos assinantes.
- **Manutenção**: janela de início e fim, componentes afetados, lembrete automático (ex.: 24 h antes) e notificações de início e fim.
- **Backfill**: registro de incidentes passados, para que o histórico fique correto.

### 2.7 Monitoramento automático

- Tipos de checagem:
  - **HTTP(S)**: código de resposta esperado, palavra-chave no corpo, tempo limite e cabeçalhos.
  - **TCP**: porta aberta.
  - **ICMP** (ping).
  - **DNS**: resolução e valor esperado.
  - **Certificado SSL**: dias até o vencimento.
- Intervalo configurável (mínimo 30 s), número de falhas consecutivas para mudar o status e número de sucessos para voltar ao normal.
- Comportamento escolhido por monitor:
  - **Automático**: altera o status do componente e, opcionalmente, abre um incidente a partir de um template.
  - **Sugestão**: cria um alerta no painel para o operador confirmar.
- A latência medida alimenta as métricas públicas.

### 2.8 Webhooks de entrada

- Endpoint por origem (`/api/hooks/in/{source}/{token}`), com token próprio e verificação HMAC opcional.
- Adaptadores nativos: **Prometheus Alertmanager**, **Grafana**, **Zabbix** (media type webhook), **Uptime Kuma** e **JSON genérico** com mapeamento de campos.
- Regras de mapeamento: alerta ou rótulo → componente → status. O mesmo comportamento automático ou de sugestão do monitoramento se aplica.

### 2.9 API, feeds e widget

- **API REST pública** (apenas leitura): status, componentes, incidentes, manutenções e métricas.
- **API REST administrativa** com tokens: escopo por página, permissões e data de expiração. Os tokens são armazenados como hash.
- **Webhooks de saída** por evento, assinados por HMAC.
- **RSS/Atom** por página.
- **Widget**: selo de status e mini painel para incorporar em outros sites.
- Documentação no padrão OpenAPI 3, com interface Swagger.

### 2.10 Exportar e importar

- Exportação em JSON versionado com: páginas, temas, componentes, grupos, monitores, templates, canais (sem segredos, ou com segredos cifrados por senha) e mapeamentos LDAP.
- Importação com pré-visualização e confirmação, nos modos "mesclar" ou "substituir".
- Exportação separada do histórico de incidentes e da lista de assinantes, por conter dados pessoais.
- O backup completo do banco (`pg_dump`) segue documentado à parte.

---

## 3. Autenticação, autorização e segurança de acesso

### 3.1 Provedores de login

- **Local**: usuário e senha, com hash argon2id.
- **LDAP**, com uma ou mais configurações:
  - Tipos: **Microsoft Active Directory** e **OpenLDAP**, com valores padrão pré-preenchidos para cada um.
  - Conexão: `ldap://` com StartTLS ou `ldaps://`, CA personalizada e opção de validar o certificado.
  - Bind de serviço para busca do usuário: base DN, filtro (ex.: `(sAMAccountName={username})` ou `(uid={username})`) e atributos de nome e e-mail.
  - Leitura dos grupos do usuário: `memberOf` no AD (inclusive grupos aninhados, via `LDAP_MATCHING_RULE_IN_CHAIN`) e `groupOfNames`/`memberUid` no OpenLDAP.
  - Botão de **teste de conexão** e de **teste de login** na interface.
  - O usuário é criado no primeiro login (JIT) e sincronizado a cada login. Uma conta desativada no AD perde o acesso.
- **Conta de emergência local** (break-glass), que continua funcionando mesmo com o LDAP fora do ar.

### 3.2 Papéis (por página)

| Papel | Permissões |
|---|---|
| **Dono** (global) | Tudo, incluindo configuração da instalação, provedores LDAP, SMTP e usuários |
| **Admin** | Configuração completa da página: tema, domínio, componentes, canais, monitores e equipe |
| **Operador** | Cria e atualiza incidentes, manutenções e postmortems; altera o status de componentes |
| **Leitor** | Acesso ao painel em modo leitura e às páginas privadas |

- **Mapeamento grupo LDAP → papel por página**. Exemplo: `CN=NOC,OU=Grupos,DC=empresa,DC=local` → Operador na página "Interna".
- Um papel atribuído manualmente prevalece sobre o mapeado, se o administrador assim configurar.

### 3.3 MFA

- MFA é **opcional por padrão** e pode ser habilitado pelo próprio usuário.
- Métodos:
  - **TOTP**, compatível com Google Authenticator, Microsoft Authenticator, Authy e similares.
  - **WebAuthn/passkeys**: chaves de segurança e biometria do dispositivo.
  - **Códigos de recuperação**: 10 códigos de uso único, armazenados como hash.
- **Política de obrigatoriedade** configurável pelo Dono: desativada, obrigatória para alguns papéis ou obrigatória para todos.
- O MFA vale para contas locais **e** LDAP: é um segundo fator aplicado depois do bind.
- O Dono e o Admin podem redefinir o MFA de um usuário. A ação é registrada na auditoria.

### 3.4 Proteções

- **Bloqueio progressivo** de login: após 5 falhas, a espera cresce exponencialmente. O bloqueio vale por conta e por IP.
- **Limite de requisições** controlado no Redis para login, assinatura, envio de código e API.
- **Política de senha** local: mínimo de 12 caracteres, verificação contra uma lista de senhas comuns, sem troca forçada periódica.
- Sessão em **cookie httpOnly, Secure e SameSite=Lax**, com proteção CSRF, expiração por inatividade e lista de sessões ativas que podem ser encerradas.
- **Log de auditoria** somente de inclusão: autor, ação, entidade, valores antes e depois, IP e user-agent. Tem filtros e exportação para CSV.

---

## 4. Arquitetura

### 4.1 Serviços (Docker Compose)

```
                ┌────────────────────────────┐
  Internet ───▶ │ proxy (Caddy) TLS auto     │
                └──────┬───────────────┬─────┘
                       │               │
               ┌───────▼──────┐  ┌─────▼──────┐
               │ web (Next.js)│─▶│ api (Nest) │
               │ pública+admin│  │ REST/OpenAPI│
               └──────────────┘  └──┬──────┬──┘
                                    │      │
                    ┌───────────────┘      └───────────┐
              ┌─────▼─────┐   ┌───────────┐   ┌────────▼───┐
              │ PostgreSQL│   │   Redis   │◀──│ worker     │ notificações,
              └───────────┘   └─────▲─────┘   │ (BullMQ)   │ uptime, limpeza
                                    │         └────────────┘
                              ┌─────┴──────┐
                              │ monitor    │ checagens agendadas
                              └────────────┘
```

| Serviço | Função |
|---|---|
| `proxy` | **Caddy**: TLS automático (Let's Encrypt com *on-demand TLS* validado pela API para domínios personalizados) ou certificados próprios |
| `web` | Next.js: página pública renderizada no servidor com cache (ISR) e painel administrativo |
| `api` | NestJS: regras de negócio, autenticação, API pública e administrativa, webhooks de entrada |
| `worker` | Processamento das filas: envios, novas tentativas, agregação de uptime, limpeza de códigos expirados |
| `monitor` | Agendador e execução das checagens. Precisa de `CAP_NET_RAW` para ICMP |
| `postgres` | Banco principal |
| `redis` | Filas, cache, limite de requisições e sessões |
| `mailpit` | Somente em desenvolvimento, para capturar e-mails |

Uploads (logos, fontes) ficam em volume local, com suporte opcional a armazenamento compatível com S3 (ex.: MinIO).

### 4.2 Stack detalhada

| Área | Escolha |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Backend | NestJS, Prisma (ORM e migrations), Zod para validação |
| Frontend | Next.js (App Router), Tailwind CSS com tokens de tema via CSS variables, next-intl |
| Gráficos | Recharts |
| Fila | BullMQ |
| LDAP | `ldapts` |
| MFA | `otplib` (TOTP), `@simplewebauthn/server` (WebAuthn) |
| Senhas | `argon2` |
| E-mail | `nodemailer` + templates MJML |
| Sanitização | DOMPurify (HTML), PostCSS com allowlist (CSS), sanitização de SVG |
| Testes | Vitest (unitários), Supertest (API), Playwright (ponta a ponta) |
| CI | GitHub Actions: lint, typecheck, testes, build e publicação das imagens |
| Observabilidade | Logs JSON (pino), `/healthz` e `/readyz`, métricas Prometheus em `/metrics` |

### 4.3 Estrutura do repositório

```
apps/
  api/        # NestJS
  web/        # Next.js (pública + admin)
  worker/     # consumidores BullMQ
  monitor/    # agendador de checagens
packages/
  db/         # schema Prisma, migrations, seed
  shared/     # tipos, schemas Zod, constantes de status
  i18n/       # traduções pt-BR, en-US, es
  notifiers/  # adaptadores de canais (email, whatsapp, telegram, slack, ...)
  ui/         # componentes compartilhados
docker/       # Dockerfiles, docker-compose.yml, Caddyfile
docs/         # planejamento, instalação, operação
```

---

## 5. Segurança (requisitos não funcionais)

- **Segredos cifrados em repouso** (senha SMTP, tokens de bot, senha do bind LDAP, tokens do WhatsApp) com AES-256-GCM. A chave mestra vem de variável de ambiente ou Docker secret.
- **CSS e HTML personalizados**:
  - HTML sanitizado e sem `<script>` por padrão. Scripts de terceiros, como analytics, só entram por um campo separado e com aviso explícito.
  - CSS sem `expression()` e sem `url()` para domínios fora da allowlist.
- **CSP** rígida na página pública e no painel.
- **Uploads**: validação de tipo real (magic bytes), limite de tamanho e SVG sanitizado.
- **SSRF**:
  - Os webhooks informados por assinantes só aceitam domínios conhecidos (`hooks.slack.com`, `discord.com`, `chat.googleapis.com`, domínios de Workflows do Teams) e nunca IPs privados.
  - Os monitores podem apontar para a rede interna, porque são criados por administradores.
- Cabeçalhos de segurança (HSTS, X-Content-Type-Options, Referrer-Policy) e cookies seguros.
- Dependências verificadas no CI (`pnpm audit`, Dependabot) e imagens Docker não root.

---

## 6. Modelo de dados (entidades principais)

| Domínio | Entidades |
|---|---|
| Páginas | `Page`, `PageTheme` (rascunho e publicado), `PageDomain`, `PageAccessRule` (login, CIDRs) |
| Catálogo | `ComponentGroup`, `Component`, `PageComponent` (vínculo N:N com ordem), `ComponentStatusHistory` |
| Incidentes | `Incident`, `IncidentUpdate`, `IncidentComponent`, `IncidentTemplate`, `Postmortem` |
| Manutenção | `Maintenance`, `MaintenanceUpdate`, `MaintenanceComponent` |
| Disponibilidade | `UptimeDaily` (tempo em cada status por componente e dia), `Metric`, `MetricPoint` |
| Monitoramento | `Monitor`, `MonitorCheckResult` (com retenção), `InboundSource`, `InboundMappingRule`, `Alert` (sugestões) |
| Assinantes | `Subscriber`, `SubscriberChannel`, `SubscriberComponent`, `VerificationCode` (hash, expiração, tentativas), `ConsentRecord` |
| Notificações | `NotificationChannel` (da equipe), `NotificationTemplate`, `NotificationDelivery` |
| Identidade | `User`, `UserIdentity` (local ou LDAP), `LdapProvider`, `LdapGroupMapping`, `Role`, `UserPageRole`, `Session` |
| MFA | `TotpSecret`, `WebAuthnCredential`, `RecoveryCode`, `MfaPolicy` |
| Integrações | `ApiToken`, `OutboundWebhook` |
| Sistema | `AuditLog`, `Setting`, `Upload` |

**Cálculo de uptime:** o `ComponentStatusHistory` registra cada mudança de status. Um job diário agrega esses dados em `UptimeDaily`. O peso de cada status é configurável por página; o padrão é interrupção total = 100% de indisponibilidade e interrupção parcial = 30%. Manutenção programada não conta como indisponibilidade.

---

## 7. Telas

**Pública**
- Página de status (inicial)
- Detalhe do incidente
- Histórico
- Detalhe da manutenção
- Assinatura e confirmação por código
- Gerenciar e cancelar assinatura
- Login de página privada

**Painel administrativo**
- Login → MFA → seleção de página
- Dashboard: incidentes ativos, alertas sugeridos, status geral
- Incidentes: lista, criação, atualização e postmortem
- Manutenções
- Componentes e grupos
- Monitores e webhooks de entrada
- Métricas
- Aparência: editor de tema com pré-visualização ao vivo
- Domínios e acesso (visibilidade, CIDRs)
- Assinantes
- Canais da equipe e templates de mensagem
- Equipe e papéis
- Tokens de API e webhooks de saída
- Exportar e importar
- **Configurações globais** (Dono): SMTP, WhatsApp, bot do Telegram, provedores LDAP, política de MFA e senha, auditoria
- Perfil: senha, MFA, sessões ativas

---

## 8. Fases e backlog

### F0 — Fundação
- Monorepo (pnpm + Turborepo), lint e format, TypeScript estrito
- Docker Compose de desenvolvimento e produção, Caddyfile
- Schema Prisma inicial, migrations e seed
- CI no GitHub Actions
- Estrutura de i18n com os três idiomas

**Pronto quando:** `docker compose up` sobe todos os serviços e o CI passa.

### F1 — Núcleo
- Páginas (já com suporte a várias), componentes, grupos e histórico de status
- Incidentes, atualizações e manutenções, com início e fim automáticos
- Página pública com banner, componentes, barra de 90 dias, incidentes e histórico
- Login local, papéis, sessões, bloqueio progressivo, limite de requisições e política de senha
- Log de auditoria
- Templates de incidente e backfill

**Pronto quando:** um operador abre, atualiza e resolve um incidente; a página pública reflete a mudança; a auditoria registra tudo.

### F2 — Personalização e acesso às páginas
- Editor de tema com pré-visualização, rascunho e publicação
- Uploads de logo, favicon e fontes
- CSS e HTML personalizados sanitizados
- Domínio personalizado com TLS on-demand
- Página privada (login e/ou CIDR)
- Seletor de idioma e fuso do visitante

**Pronto quando:** duas páginas com identidades visuais diferentes rodam em domínios diferentes, sendo uma delas privada.

### F3 — Autenticação corporativa e MFA
- Provedores LDAP (AD e OpenLDAP), testes de conexão, criação de usuário no primeiro login e sincronização
- Mapeamento de grupos para papéis
- MFA com TOTP, WebAuthn e códigos de recuperação
- Política de obrigatoriedade de MFA
- Conta de emergência local

**Pronto quando:** um usuário do AD faz login com MFA e recebe o papel correto a partir do seu grupo; um usuário desativado no AD perde o acesso.

### F4 — Notificações
- Fila BullMQ, novas tentativas e registro de entregas
- Canais da equipe: E-mail, Telegram, Slack, Discord, Teams, Google Chat, WhatsApp e webhook genérico
- Templates por canal, evento e idioma
- Assinatura pública com **confirmação obrigatória por código de e-mail**, validação dos outros canais, gerenciamento e cancelamento, registro de consentimento
- Importação e exportação de assinantes

**Pronto quando:** um incidente dispara mensagens em todos os canais configurados; um assinante sem código confirmado não recebe nada.

### F5 — Monitoramento e integrações de entrada
- Serviço `monitor` com checagens HTTP, TCP, ICMP, DNS e SSL
- Modos automático e de sugestão, com abertura de incidente por template
- Webhooks de entrada: Alertmanager, Grafana, Zabbix, Uptime Kuma e genérico
- Métricas públicas e gráficos
- Postmortem

**Pronto quando:** derrubar um serviço monitorado muda o status do componente (ou gera uma sugestão) e a mudança é notificada aos assinantes.

### F6 — API, distribuição e operação
- API pública e administrativa (OpenAPI), tokens com escopo
- Webhooks de saída, RSS/Atom e widget
- Exportação e importação de configuração
- Hardening final: CSP, revisão de segurança, testes de carga da página pública
- Documentação de instalação, atualização, backup e restauração

**Pronto quando:** existe uma release versionada com imagens Docker publicadas e o guia de instalação on-premise foi validado do zero.

---

## 9. Riscos e pontos de atenção

| Risco | Mitigação |
|---|---|
| WhatsApp exige conta Business verificada, templates aprovados e tem custo por conversa | Documentar o processo de configuração; manter o canal desabilitado até a configuração; usar templates genéricos com variáveis |
| Webhooks "Office 365 Connectors" do Teams foram descontinuados pela Microsoft | Usar exclusivamente webhooks de Workflows (Power Automate) com Adaptive Cards |
| E-mails caindo em spam | Documentar a configuração de SPF, DKIM e DMARC; permitir relay SMTP corporativo |
| ICMP dentro do container exige capability extra | `cap_add: NET_RAW` somente no serviço `monitor` |
| TLS automático requer portas 80/443 acessíveis pela internet | Alternativa com certificado próprio ou desafio DNS; documentar o cenário só intranet |
| Picos de acesso à página pública durante incidentes | Renderização com cache (ISR), cache no proxy e API pública com cache curto |
| CSS e HTML personalizados como vetor de XSS | Sanitização no servidor, CSP rígida e scripts de terceiros apenas com aviso explícito |
| Dados pessoais de assinantes (LGPD) | Registro de consentimento, exclusão pelo próprio assinante, exportação separada |
