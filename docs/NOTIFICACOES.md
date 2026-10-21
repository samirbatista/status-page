# Notificações e assinantes

Guia de configuração das notificações (F4). Há três níveis:

1. **Provedores globais** (Dono, Painel → Notificações): SMTP, bot do Telegram e WhatsApp.
2. **Canais da equipe** (Admin da página, Página → Notificações → Canais da equipe).
3. **Assinantes** (visitantes da página pública, botão "Assinar atualizações").

Defina `PUBLIC_URL` no `.env` com o endereço público do site (ex.: `https://status.empresa.com.br`):
ele monta os links de cada mensagem. Páginas com domínio próprio verificado usam esse domínio.

## Como os envios funcionam

- Ao publicar um incidente, uma atualização ou uma manutenção com **"Notificar assinantes"**
  marcado, o evento é gravado na mesma transação (incidentes retroativos nunca notificam).
- O `worker` cria uma entrega para cada canal da equipe interessado e para cada assinante
  **confirmado** cujo filtro (componentes e tipo de evento) bate com o evento. Inscrições
  sem confirmação não recebem nada.
- Cada entrega é tentada até 7 vezes, com espera exponencial (30 s, 1, 2, 4, 8 e 16 min).
  Erros definitivos (4xx, endereço recusado) não são repetidos. Tudo fica em
  **Notificações → Entregas**, com o erro e o botão **Reenviar**.
- Limite global de `NOTIFY_RATE_PER_SECOND` envios por segundo (padrão 20).
- Lembrete automático 24 h antes das manutenções agendadas com mais de 24 h de antecedência.

## Provedores globais

### E-mail (SMTP)

Servidor, porta, segurança (STARTTLS, TLS ou nenhuma), usuário/senha e remetente. A senha
fica cifrada. Use **Enviar teste** para validar. Para não cair em spam, configure **SPF,
DKIM e DMARC** do domínio do remetente (ou use o relay SMTP corporativo).

### Bot do Telegram

1. Crie o bot com o [@BotFather](https://t.me/BotFather) (`/newbot`) e cole o token.
2. O token é validado no Telegram (`getMe`) e o nome do bot aparece na tela.

O worker lê as mensagens do bot por *long polling*, então funciona em rede interna sem URL
pública. Para um canal da equipe, adicione o bot ao grupo/canal e use o chat ID
(ex.: `-1001234567890`). O visitante assina abrindo `t.me/<bot>?start=<token>`; `/stop`
cancela.

### WhatsApp (Cloud API)

Requer conta **WhatsApp Business verificada** e templates **aprovados pela Meta**. Fora da
janela de 24 h, só saem mensagens por template, com custo por conversa.

- **Template de notificação** (categoria *Utility*), com duas variáveis no corpo, por exemplo:
  `{{1}}` — `{{2}}` (título e texto da notificação).
- **Template de código** (categoria *Authentication*), com o botão de copiar código.
- Informe o *Phone Number ID*, o token de acesso e o idioma dos templates (ex.: `pt_BR`).

## Canais da equipe

| Canal | O que informar |
|---|---|
| E-mail | Destinatários (um por linha) |
| Telegram | Chat ID do grupo/canal |
| Slack | Incoming Webhook (`https://hooks.slack.com/...`) |
| Discord | Webhook do canal |
| Microsoft Teams | Webhook de um fluxo do **Workflows (Power Automate)** — os *Office 365 Connectors* foram descontinuados. A mensagem chega como Adaptive Card. |
| Google Chat | Webhook do espaço (mensagem em Card) |
| WhatsApp | Números com código do país |
| Webhook genérico | URL e segredo HMAC opcional |

Cada canal escolhe os eventos (incidentes, manutenções), o idioma e tem o botão
**Enviar teste**. URLs e segredos ficam cifrados e mascarados na tela.

### Webhook genérico

`POST` com JSON:

```json
{ "event": "incident_created", "subject": "...", "text": "...", "url": "...", "data": { ... }, "sentAt": "..." }
```

Cabeçalhos: `X-StatusPage-Event`, `X-StatusPage-Timestamp` e, com segredo,
`X-StatusPage-Signature: sha256=<hex>` = HMAC-SHA256 de `<timestamp>.<corpo>`. Para validar:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(`${timestamp}.${rawBody}`).digest('hex');
crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
```

Recuse requisições com timestamp muito antigo (ex.: mais de 5 minutos).

## Mensagens (templates)

Em **Notificações → Mensagens**, personalize assunto e texto por evento, idioma e canal (ou
"todos os canais"). Sem personalização, vale o texto padrão. Variáveis disponíveis:

`{{page.name}}` `{{page.url}}` `{{event.label}}` `{{incident.title}}` `{{incident.status}}`
`{{incident.impact}}` `{{incident.url}}` `{{maintenance.title}}` `{{maintenance.status}}`
`{{maintenance.start}}` `{{maintenance.end}}` `{{maintenance.url}}` `{{update.body}}`
`{{components}}` `{{component.name}}`

Os links "ver na página", "gerenciar inscrição" e "cancelar inscrição" são sempre
acrescentados, mesmo em templates personalizados. Variáveis desconhecidas são recusadas ao
salvar.

## Assinantes

- **E-mail**: código de 6 dígitos válido por 15 minutos, no máximo 5 tentativas; reenvio
  após 60 s e até 5 envios por hora por endereço e por IP. Só o hash do código é guardado.
- **WhatsApp**: mesmo fluxo, com o código pelo template de autenticação.
- **Telegram**: link para o bot; a inscrição ativa no `/start`.
- **Slack, Discord, Teams e Google Chat**: a URL precisa ser HTTPS e do domínio oficial do
  serviço, sem resolver para IP privado (proteção contra SSRF). Uma mensagem de teste
  valida o endereço. Em laboratório, `WEBHOOK_EXTRA_HOSTS` libera hosts adicionais.
- Inscrições não confirmadas são apagadas após 24 h.
- Toda mensagem leva o link de **gerenciar** (componentes, eventos, idioma) e de
  **cancelar**. A pessoa também pode **excluir os dados**.
- **LGPD**: cada inscrição, confirmação, alteração, cancelamento e exclusão gera um
  registro de consentimento (data, IP, user-agent e texto aceito). Após a exclusão fica só
  esse registro, sem o contato. Os contatos ficam cifrados no banco.

### Importação e exportação

- **Exportar CSV**: contatos completos, para migração (a ação vai para a auditoria).
- **Importar CSV**: coluna `email` (opcionais `locale` e `components`, com nomes separados
  por `|`), até 1.000 linhas. Cada contato recebe um **convite** por e-mail e só passa a
  receber notificações depois de confirmar pelo link (válido por 7 dias).
