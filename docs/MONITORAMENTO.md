# Monitoramento, integrações e postmortem

Guia da F5. Há duas formas de o status de um componente mudar sozinho:

1. **Monitores** (Página → Monitores): o serviço `monitor` checa HTTP(S), porta TCP, ping,
   DNS ou certificado SSL no intervalo configurado.
2. **Integrações** (Página → Integrações): ferramentas que você já usa (Prometheus
   Alertmanager, Grafana, Zabbix, Uptime Kuma ou qualquer sistema que envie JSON) chamam uma
   URL secreta, e regras ligam cada alerta a um componente.

Nos dois casos você escolhe o **modo**:

| Modo           | Quando o serviço cai                                                                  | Quando volta                                                       |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Automático** | Aplica o status de falha no componente; com template, abre um incidente               | Restaura o status anterior e resolve o incidente aberto            |
| **Sugestão**   | Cria um alerta em **Visão geral → Alertas sugeridos**; o Operador aplica ou descarta | Fecha a sugestão pendente ou sugere a normalização ao Operador     |

Assinantes são avisados de toda mudança aplicada: pelo incidente (aberto e resolvido) ou,
sem template, por um evento **"Status do componente alterado"**, que respeita o filtro de
componentes de cada assinante e pode ter a mensagem personalizada em Notificações → Mensagens.

Regras da normalização:

- O status volta ao que era **antes** da falha. Se alguém mudou o status à mão enquanto o
  serviço estava fora, a automação não sobrescreve.
- Se duas origens derrubaram o mesmo componente, ele só volta quando as duas normalizarem
  (fica com o pior status entre as falhas ainda ativas).
- Excluir ou desativar um monitor/integração, trocar o componente ou o alvo normaliza o que
  ele tinha aplicado e fecha as sugestões abertas.
- Tudo fica no log de auditoria (`automation.failure`, `automation.recovery`, `alert.accept`...).

## Monitores

| Tipo             | Alvo                     | Opções                                                                                       |
| ---------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| HTTP(S)          | URL                      | Método (GET, HEAD, POST), códigos aceitos (`200-299,301`), palavra-chave (deve ou não aparecer), seguir redirecionamentos, verificar TLS, cabeçalhos |
| Porta TCP        | Host                     | Porta                                                                                        |
| Ping (ICMP)      | Host ou IP               | —                                                                                            |
| DNS              | Nome                     | Registro (A, AAAA, CNAME, MX, TXT, NS), valor esperado, servidor DNS                         |
| Certificado SSL  | Host                     | Porta (443) e dias mínimos até o vencimento (14)                                             |

- **Intervalo** mínimo de 30 s; **tempo limite** de 1 a 60 s.
- **Falhas para cair** (padrão 3) e **sucessos para voltar** (padrão 2) evitam alarmes por
  uma oscilação.
- **Cabeçalhos HTTP** (ex.: `Authorization`) ficam cifrados com o `APP_SECRET`; o painel só
  mostra os nomes. Em branco na edição mantém os atuais.
- **Testar agora** roda a checagem com o que está no formulário, sem salvar nada.
- A tela do monitor mostra a latência e a disponibilidade em 24 h, 7 e 30 dias e as últimas
  checagens. Os resultados ficam guardados por 31 dias (limpeza diária no `worker`).
- O agendador "reivindica" cada monitor no banco antes de checar, então dá para rodar mais de
  uma réplica do serviço `monitor` sem checagens duplicadas. `MONITOR_CONCURRENCY` (padrão 20)
  limita as checagens simultâneas por réplica.

O ping usa o binário `ping` (pacote `iputils-ping`, já instalado na imagem do monitor) e
precisa da capacidade `NET_RAW`, já liberada no `compose.yaml`.

Os monitores rodam dentro da sua rede: podem checar serviços internos que não estão expostos
à internet. Só Admins da página configuram monitores.

## Integrações (webhooks de entrada)

Cada integração recebe uma URL secreta, exibida só para Admins:

```
https://status.empresa.com.br/api/hooks/in/<id>/<token>
```

**Gerar nova URL** invalida a anterior. Opcionalmente, defina um **segredo HMAC**: a
requisição passa a exigir o cabeçalho `X-Signature: sha256=<hex>` (ou `X-Hub-Signature-256`)
com o HMAC-SHA256 do corpo. Limite de 120 requisições por minuto por integração; corpo de
até 1 MB e 100 alertas por requisição.

### Regras

A primeira regra (de cima para baixo) que casar define o **componente** e o **status de
falha**. O campo é `name` (nome do alerta) ou `label:<chave>` (um rótulo/tag); o padrão
aceita `*` como curinga e não diferencia maiúsculas. Alertas sem regra são recebidos e
ignorados; a tela mostra o último recebimento com o que casou e o que ficou sem regra.

O mesmo alerta (mesmo identificador) em falha e depois normalizado abre e fecha a mesma
automação.

### Prometheus Alertmanager

```yaml
receivers:
  - name: status-page
    webhook_configs:
      - url: https://status.empresa.com.br/api/hooks/in/<id>/<token>
        send_resolved: true
```

Identificador: `fingerprint`; nome: `labels.alertname`; rótulos: `labels`; mensagem:
`annotations.summary`. Exemplo de regra: `label:service` = `api*`.

### Grafana

Alerting → Contact points → **Webhook**, método POST, com a URL da integração. Funciona com o
alerting unificado (mesmo formato do Alertmanager) e com os alertas legados
(`state: alerting/ok`).

### Zabbix

Crie um *media type* do tipo **Webhook** que envie um JSON com `event_id`, `name`, `host`,
`status` (`PROBLEM`/`RESOLVED`, ou `event_value` 1/0), `severity`, `message` e `tags`
(lista `[{tag, value}]` ou objeto). Os rótulos disponíveis nas regras são as tags, `host` e
`severity`.

### Uptime Kuma

Notificações → **Webhook**, corpo `application/json`, com a URL da integração. `heartbeat.status`
0 é falha e 1 é normalizado; o nome é o do monitor no Kuma. A mensagem de teste do Kuma é
aceita e ignorada.

### JSON genérico

Os campos são lidos por caminhos com pontos (`data.alerts.0.name`):

| Campo              | Padrão                          | Para que serve                                      |
| ------------------ | ------------------------------- | --------------------------------------------------- |
| Lista de alertas   | vazio (o corpo é um alerta só)  | Onde está a lista, ex.: `alerts`                    |
| Identificador      | `id`                            | Liga o disparo à normalização                       |
| Nome               | `name`                          | Usado em regras `name`                              |
| Status             | `status`                        | Comparado com os valores "em falha"                 |
| Valores em falha   | `firing, down, problem, 1`      | Qualquer outro valor é normalizado                  |
| Rótulos            | `labels`                        | Objeto usado em regras `label:<chave>`              |
| Mensagem           | `message`                       | Detalhe exibido no alerta                           |

```bash
curl -X POST https://status.empresa.com.br/api/hooks/in/<id>/<token> \
  -H 'Content-Type: application/json' \
  -d '{"id":"backup-noturno","name":"backup","status":"down","labels":{"service":"backup"},"message":"Falhou às 03:00"}'
```

## Métricas públicas

Marque **"Exibir latência e disponibilidade na página pública"** no monitor (ele precisa estar
ligado a um componente da página). A página pública ganha o link **Ver desempenho**
(`/p/<endereço>/metrics`), com latência média e disponibilidade em 24 h, 7 dias e 30 dias.
O alvo do monitor (URL, host) nunca é exibido.

## Postmortem

Na tela do incidente (Operador ou acima), escreva a análise em **Markdown**: resumo, linha do
tempo, causa raiz e ações. O rascunho é interno; **Publicar** exibe o texto na página pública
do incidente e, se marcado, avisa os assinantes (só na primeira publicação). **Despublicar**
tira da página. O HTML é gerado e sanitizado no servidor: sem HTML bruto, scripts ou imagens
externas, e links abrem em nova aba com `rel="noopener noreferrer nofollow"`.
