# Instalação, atualização, backup e restauração

Guia para instalar a Status Page on-premise a partir das imagens publicadas no GitHub
Container Registry (`ghcr.io/samirbatista/status-page/*`). Nenhuma compilação é necessária
no servidor.

## Requisitos

- Linux x86_64 ou arm64 com **Docker 24+** e o plugin **Docker Compose v2**.
- 2 vCPU, 2 GB de RAM e 10 GB de disco para começar (veja [Capacidade](#capacidade)).
- Portas 80 e 443 livres (ou outras, ajustando `HTTP_PORT` e `HTTPS_PORT`).
- Para HTTPS automático: um nome DNS apontando para o servidor e as portas 80/443
  acessíveis pela internet (Let's Encrypt). Em rede interna, use HTTP ou seu próprio
  proxy/certificado na frente.
- Saída para a internet só é necessária para baixar as imagens, emitir certificados e
  enviar notificações para serviços externos (Slack, Telegram, WhatsApp...).

## Instalação do zero

```bash
# 1. Arquivos da versão (compose, Caddyfile, .env.example e scripts)
git clone --depth 1 --branch v1.0.2 https://github.com/samirbatista/status-page.git
cd status-page

# 2. Configuração
cp .env.example .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -base64 32)|" .env
nano .env   # SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD (12+ caracteres), SITE_ADDRESS e PUBLIC_URL

# 3. Sobe a stack com as imagens publicadas
docker compose pull
docker compose up -d --no-build --wait
```

O serviço `migrate` aplica as migrações do banco, cria a conta Dono e termina. Acesse
`PUBLIC_URL/admin` e entre com `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.

Variáveis principais do `.env`:

| Variável              | Para que serve                                                                 |
| --------------------- | ------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD`   | Senha do banco (só letras e números).                                          |
| `APP_SECRET`          | Chave que cifra os segredos guardados. **Guarde com o backup**; trocá-la torna os segredos ilegíveis. |
| `SEED_OWNER_*`        | Conta Dono criada no primeiro start (também é a conta de emergência).          |
| `SITE_ADDRESS`        | Domínio principal (ex.: `status.empresa.com.br`) para HTTPS automático. Vazio = HTTP na porta 80. |
| `PUBLIC_URL`          | Endereço público usado nos links das notificações e feeds.                     |
| `IMAGE_PREFIX`        | Registro das imagens (`ghcr.io/samirbatista/status-page`).                     |
| `IMAGE_TAG`           | Versão instalada (ex.: `1.0.2`).                                               |

Para compilar as imagens a partir do código (sem o registro), use `IMAGE_PREFIX=status-page`
e `docker compose up -d --build`.

### Conferindo

```bash
docker compose ps                                   # todos "healthy"; migrate "exited (0)"
curl -fsS http://localhost/api/readyz               # {"status":"ok",...}
curl -fsS http://localhost/api/docs/openapi.json | jq .info.version
```

## Atualização

1. Leia as notas da release (mudanças que exigem ação aparecem no topo).
2. Faça um backup (seção abaixo).
3. Troque a versão e suba de novo:

```bash
git fetch --tags && git checkout v1.1.0      # compose e Caddyfile da nova versão
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=1.1.0/' .env
docker compose pull
docker compose up -d --no-build --wait
```

As migrações rodam sozinhas no `migrate` antes de a API subir. Elas só avançam: para voltar
a uma versão anterior, restaure o backup feito antes da atualização (o banco migrado não
roda numa versão mais antiga).

## Backup

```bash
scripts/backup.sh /caminho/dos/backups
```

Gera uma pasta com:

- `database.dump` — `pg_dump` no formato custom (todo o conteúdo: páginas, incidentes,
  assinantes, usuários, auditoria, segredos cifrados);
- `uploads.tar.gz` — logos, imagens e fontes enviadas;
- `caddy-data.tar.gz` — certificados emitidos (evita reemitir tudo na restauração);
- `VERSION` e `SHA256SUMS`.

O `.env` **não** entra no backup: guarde-o separadamente, em local seguro (cofre de
senhas). Sem o mesmo `APP_SECRET`, SMTP, LDAP, webhooks e tokens precisam ser
reconfigurados. Agende o script (ex.: cron diário) e copie as pastas para fora do servidor.

O Redis guarda apenas filas e limites de requisição; não precisa de backup.

Além do backup completo, o painel oferece:

- **Exportar configuração** (Dono → Exportar e importar): páginas, temas, componentes,
  monitores, integrações, canais e LDAP em JSON, com os segredos cifrados por uma senha.
  Útil para replicar a configuração em outra instalação (homologação → produção).
- **Exportar histórico** (Página → API e incorporação) e **assinantes em CSV**
  (Página → Notificações → Assinantes), tratados à parte por conterem dados pessoais.

## Restauração

Na mesma versão (ou mais nova) e com o `.env` original:

```bash
scripts/restore.sh /caminho/dos/backups/status-page-20261022T030000Z
```

O script confere as somas, pede confirmação, para a aplicação, recria o banco com
`pg_restore`, repõe os arquivos e certificados e sobe tudo de novo.

Para mudar de servidor: instale do zero com o mesmo `.env`, rode o `restore.sh` e aponte o
DNS para o novo servidor.

## Operação

- **Logs**: `docker compose logs -f api worker monitor` (JSON, um evento por linha).
- **Saúde**: `/api/healthz` (processo no ar) e `/api/readyz` (banco e Redis); os serviços
  têm healthcheck no compose e reiniciam sozinhos (`restart: unless-stopped`).
- **Fila de notificações**: entregas e falhas ficam em Página → Notificações → Entregas.
- **Auditoria**: Painel → Auditoria (filtros e exportação CSV).
- **Escala**: `monitor` e `worker` podem ter réplicas (`docker compose up -d --scale
  monitor=2`); o agendador evita checagens duplicadas.

## Capacidade

Teste de carga (v1.0.0) com a stack completa num único host de 4 vCPU e 16 GB, que também
rodava o gerador de carga ([autocannon](https://github.com/mcollina/autocannon), 100
conexões simultâneas por 30 s, passando pelo Caddy), página de exemplo com 3 componentes:

| Rota                                          | Requisições/s | p50     | p99     | Erros |
| --------------------------------------------- | ------------- | ------- | ------- | ----- |
| `GET /api/public/pages/<slug>` (resumo JSON)  | ~1000         | 95 ms   | 170 ms  | 0     |
| `GET /api/public/pages/<slug>/status.json`    | ~540          | 176 ms  | 291 ms  | 0     |
| `GET /p/<slug>` (HTML, 1 réplica do `web`)    | ~85           | 1,0 s   | 5,2 s   | 0     |
| `GET /p/<slug>` (HTML, 3 réplicas do `web`)   | ~150          | 0,3 s   | 2,2 s   | 0     |

- O resumo das páginas públicas fica em cache por 5 s para visitantes anônimos
  (`PUBLIC_CACHE_SECONDS`), e acessos simultâneos compartilham a mesma consulta.
- A página HTML é renderizada no servidor a cada acesso (cada resposta leva um nonce novo
  na CSP). Para mais visitas, aumente as réplicas do `web` — o Caddy distribui entre elas:
  `docker compose up -d --no-build --scale web=3`.
- 85 páginas/s equivalem a mais de 300 mil visualizações por hora; em incidentes grandes,
  o tráfego de integrações costuma ir para o JSON, que é bem mais leve.

## Segurança

- Cabeçalhos: CSP com nonce por requisição (scripts só do próprio site), `frame-ancestors`
  restrito (exceto o widget `/embed`), HSTS em HTTPS, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` e `Cross-Origin-Opener-Policy`.
- Segredos cifrados com AES-256-GCM a partir do `APP_SECRET`; tokens de API, códigos e
  sessões guardados só como hash.
- Imagens rodam como usuário sem privilégios; o CI verifica vulnerabilidades conhecidas nas
  dependências (`pnpm audit`) e o Dependabot propõe atualizações semanais.
