# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões
seguem [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.1] - 2026-10-31

Versão de segurança. **Atualize** quem estiver na 1.0.0 (passos em
[docs/INSTALACAO.md](docs/INSTALACAO.md#atualização)).

### Segurança

- Next.js 16.4.0 → 16.4.3: corrige duas falhas críticas de execução remota de código sem
  autenticação e uma negação de serviço no App Router.
- zod 4.6.7 (consumo de memória com entradas muito grandes), body-parser 2.4, qs 6.16.1 e
  multer 2.5 (negação de serviço), via NestJS 12.2 e override do pnpm.

### Dependências

- Atualizações menores agrupadas pelo Dependabot: NestJS 12.2, Prisma 7.10.1, React 19.3.1,
  BullMQ 6.4, nodemailer 10.2, ESLint, Turborepo, Vitest e outras.
- Dependabot passa a ignorar versões maiores de `@types/node` (os tipos acompanham o
  Node 24 das imagens).

## [1.0.0] - 2026-10-22

Primeira versão estável, com todo o escopo do [planejamento](docs/PLANEJAMENTO.md).

### Página pública e painel (F0–F1)

- Várias páginas por instalação; componentes e grupos; incidentes com linha do tempo,
  templates e registro retroativo; manutenções com início e fim automáticos.
- Barra de disponibilidade de 90 dias, histórico mensal, pt-BR, en-US e es.
- Papéis Leitor, Operador, Admin e Dono; log de auditoria com exportação CSV.

### Personalização e acesso (F2)

- Identidade visual por página (logos, cores, fontes, CSS/HTML sanitizados) com rascunho.
- Domínios próprios com HTTPS automático; páginas privadas por login e/ou rede (CIDR).

### Autenticação corporativa (F3)

- Active Directory e OpenLDAP (LDAPS/StartTLS), grupos mapeados para papéis e sincronização.
- MFA (TOTP, chaves de segurança e passkeys, códigos de recuperação) e conta de emergência.

### Notificações (F4)

- Canais da equipe e assinantes por e-mail, Telegram, Slack, Discord, Teams, Google Chat,
  WhatsApp e webhook assinado; mensagens por canal, evento e idioma; fila com novas
  tentativas; confirmação por código e LGPD.

### Monitoramento (F5)

- Monitores HTTP, TCP, ping, DNS e SSL; modos automático e de sugestão; webhooks de entrada
  (Alertmanager, Grafana, Zabbix, Uptime Kuma, JSON genérico); métricas públicas; postmortem.

### API, distribuição e operação (F6)

- Tokens de API por página (papel, validade, revogação) e documentação OpenAPI 3.1/Swagger.
- `status.json`, feeds RSS/Atom, selo SVG, widget (script e iframe).
- Webhooks de saída com escolha de eventos específicos.
- Exportação e importação de configuração com segredos cifrados por senha, pré-visualização
  e modos mesclar/substituir; exportação do histórico de incidentes.
- CSP com nonce, HSTS e demais cabeçalhos de segurança; `pnpm audit` no CI e Dependabot.
- Imagens Docker publicadas no GHCR (amd64 e arm64), guia de instalação, atualização,
  backup e restauração com scripts.
