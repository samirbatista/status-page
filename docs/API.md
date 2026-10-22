# API, feeds, widget e exportação

## Documentação OpenAPI

A especificação OpenAPI 3.1 fica em **`/api/docs/openapi.json`** e a interface Swagger em
**`/api/docs`**. Ela cobre a API pública (`/api/public`), os webhooks de entrada
(`/api/hooks`) e as rotas de página (`/api/pages/{pageId}/...`), que é o que um token
alcança. Os corpos das requisições são gerados dos mesmos schemas que a API usa para
validar.

## Tokens de API

Crie em **Página → API e incorporação → Tokens de API** (Admin da página):

- valem para **uma página**, com o papel **Leitor**, **Operador** ou **Admin**;
- validade de 30, 90, 365 dias ou sem expiração; revogação a qualquer momento;
- o valor (`sp_...`) aparece uma única vez; o banco guarda só o hash;
- o token age em nome de quem o criou, nunca acima do papel atual dessa pessoa na página
  e nunca com poderes de Dono. Se ela perder o acesso, o token para de funcionar;
- não alcança rotas de sessão (login, MFA, perfil), de Dono, nem cria outros tokens;
- as ações ficam na auditoria com a pessoa como autor e `api-token:sp_xxxxxx (nome)`.

```bash
TOKEN=sp_...
PAGE=01a1...   # ID da página (aparece na URL do painel)

# Abrir um incidente (Operador)
curl -X POST "https://status.empresa.com.br/api/pages/$PAGE/incidents" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Lentidão no checkout","impact":"minor","status":"investigating",
       "body":"Investigando.","notify":true,
       "components":[{"componentId":"<id>","status":"degraded_performance"}]}'

# Mudar o status de um componente
curl -X PUT "https://status.empresa.com.br/api/pages/$PAGE/components/<id>/status" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"operational"}'
```

Requisições com token não precisam do cabeçalho anti-CSRF (o navegador nunca envia
`Authorization` sozinho). Um token de Leitor também lê páginas privadas pela API pública.

## Leitura pública

| Rota                                          | Conteúdo                                                        |
| --------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/public/pages/{slug}`                | Resumo completo (o que a página pública mostra)                  |
| `GET /api/public/pages/{slug}/status.json`    | Status geral, componentes, incidentes e manutenções ativas       |
| `GET /api/public/pages/{slug}/history?month=` | Incidentes e manutenções do mês                                 |
| `GET /api/public/pages/{slug}/metrics?range=` | Latência e disponibilidade (`day`, `week`, `month`)              |
| `GET /api/public/pages/{slug}/feed.atom`      | Feed Atom (`?lang=pt-BR\|en-US\|es`)                             |
| `GET /api/public/pages/{slug}/feed.rss`       | Feed RSS 2.0                                                    |
| `GET /api/public/pages/{slug}/badge.svg`      | Selo de status (`?lang=`)                                       |
| `GET /api/public/pages/{slug}/widget.js`      | Script do mini painel                                            |

Tudo segue a regra de acesso da página: páginas privadas exigem login (cookie), IP liberado
ou token. Só páginas públicas liberam CORS no `status.json`. As respostas públicas têm
cache de 15 a 60 s.

## Selo e widget

Copie os trechos prontos em **Página → API e incorporação**:

```html
<!-- Selo -->
<a href="https://status.empresa.com.br/p/minha-pagina">
  <img src="https://status.empresa.com.br/api/public/pages/minha-pagina/badge.svg" alt="Status">
</a>

<!-- Mini painel: insere um iframe logo após a tag e ajusta a altura sozinho -->
<script src="https://status.empresa.com.br/api/public/pages/minha-pagina/widget.js"
        data-lang="pt-BR" async></script>

<!-- Alternativa sem JavaScript -->
<iframe src="https://status.empresa.com.br/p/minha-pagina/embed" title="Status"
        style="border:0;width:100%;height:240px"></iframe>
```

A página `/embed` é a única que pode ser exibida em iframe de outros sites; as demais só
no próprio site (CSP `frame-ancestors`).

## Webhooks de saída

Em **Página → Notificações → Canais da equipe**, um canal **Webhook genérico** recebe os
eventos em JSON. Por padrão recebe as categorias marcadas (incidentes, manutenções); em
**Eventos específicos** dá para escolher só alguns (ex.: `incident_created` e
`incident_resolved`).

```http
POST /seu-endpoint
Content-Type: application/json
X-StatusPage-Event: incident_created
X-StatusPage-Timestamp: 1761130000
X-StatusPage-Signature: sha256=<hex>

{"event":"incident_created","subject":"...","text":"...","url":"https://.../incidents/<id>",
 "data":{"type":"incident_created","page":{...},"incident":{...},"components":[...]},
 "sentAt":"2026-10-22T12:00:00.000Z"}
```

A assinatura é o HMAC-SHA256 de `<timestamp>.<corpo>` com o segredo do canal. Rejeite
timestamps com mais de 5 minutos para evitar repetição. Falhas temporárias (5xx, timeout)
são repetidas até 7 vezes com espera exponencial; o histórico fica em **Entregas**. O
formato completo está na seção `webhooks` do OpenAPI.

## Exportar e importar configuração

Em **Exportar e importar** (Dono):

- **Exportar** gera um JSON versionado (`format: status-page-config`, `version: 1`) com
  páginas e configurações de acesso, domínios, tema (rascunho e publicado) com os arquivos
  enviados, grupos, componentes, templates de incidente, mensagens personalizadas, canais,
  monitores, integrações de entrada (com as regras) e provedores LDAP com os mapeamentos.
- **Segredos** (URLs de webhook, tokens, cabeçalhos de monitores, segredos HMAC, senha do
  bind LDAP) só entram se você informar uma senha: vão cifrados com ela (scrypt +
  AES-256-GCM). Sem senha, ficam de fora.
- **Importar** mostra antes uma **pré-visualização** (o que será criado, atualizado e
  removido, e os avisos); nada é gravado até confirmar.
  - **Mesclar**: cria o que falta e atualiza o que existe (páginas pelo endereço, demais
    itens pelo nome). Nada é removido.
  - **Substituir**: nas páginas do arquivo, também remove o que não está nele. Provedores
    LDAP nunca são removidos.
- Tudo é revalidado na importação (as mesmas regras das telas; CSS e HTML do tema
  sanitizados de novo). Domínios entram sem verificação; integrações de entrada ganham
  URLs novas; canais novos sem os segredos são ignorados (com aviso); provedores LDAP sem
  senha entram desativados.
- Incidentes e assinantes não fazem parte (dados pessoais): exporte o histórico em
  **Página → API e incorporação** e os assinantes em CSV em **Notificações → Assinantes**.
