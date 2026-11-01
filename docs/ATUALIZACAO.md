# Atualização de versão

Guia para atualizar uma instalação feita com as imagens publicadas (veja
[INSTALACAO.md](INSTALACAO.md)). Antes de qualquer atualização, confira o
[caminho de atualização](#caminhos-de-atualização) da versão de destino: ele diz de quais
versões é possível partir, o que muda no banco e na configuração e como voltar atrás.

## Regras do caminho de atualização

- **Mesma versão maior (1.x → 1.y):** salto direto permitido, a menos que alguma versão
  no meio esteja marcada como **parada obrigatória**. Nesse caso, atualize primeiro para
  ela e depois siga para o destino.
- **Nova versão maior (1.x → 2.0):** atualize antes para a última 1.x e só então para a 2.0.
- **Nunca pule uma parada obrigatória:** migrações de dados podem depender dela.
- **Voltar de versão (downgrade):** só troque a versão de volta quando a seção do destino
  disser que é possível. Quando houver migração de banco, a volta é sempre pela restauração
  do backup feito antes da atualização.
- Versões de segurança aparecem como **urgente**: atualize assim que possível.

## Resumo

| Versão | Data       | Atualiza a partir de | Migrações de banco | Ação manual | Volta sem restaurar backup |
| ------ | ---------- | -------------------- | ------------------ | ----------- | -------------------------- |
| 1.0.3  | 2026-11-01 | 1.0.0                | não                | não         | sim (até a 1.0.1)          |
| 1.0.2  | 2026-11-01 | 1.0.0                | não                | não         | sim (até a 1.0.1)          |
| 1.0.1  | 2026-10-31 | 1.0.0                | não                | não         | não recomendado (1.0.0 vulnerável) |
| 1.0.0  | 2026-10-22 | instalação inicial   | —                  | —           | —                          |

## Antes de atualizar

1. **Versão atual:**

   ```bash
   cd /opt/status-page                      # pasta da instalação (onde está o compose.yaml)
   docker compose exec -T api node -p "require('./package.json').version"
   ```

2. **Caminho:** leia a seção da versão de destino logo abaixo, e a de cada versão entre a
   atual e o destino. Anote paradas obrigatórias e ações manuais.
3. **Arquivos locais:** `git status` não deve mostrar alterações em arquivos versionados.
   Se você editou o `compose.yaml` ou o `Caddyfile`, guarde a alteração em um
   `compose.override.yaml` ou anote-a para refazer depois.
4. **Espaço em disco:** o backup ocupa aproximadamente o tamanho do banco mais os uploads,
   e as imagens novas cerca de 1 GB (`df -h`).
5. **Backup e `.env`:** faça o backup (abaixo) e confira se o `.env` está guardado em lugar
   seguro. Sem o `APP_SECRET`, os segredos cifrados não podem ser lidos.
6. **Janela:** a indisponibilidade costuma durar segundos (recriação dos contêineres), mas
   avise a equipe e evite atualizar durante um incidente aberto.

## Atualizando

### Com o script (instalações na 1.0.3 ou mais nova)

```bash
scripts/upgrade.sh 1.0.4 /opt/backups/status-page
```

O script:

1. lê a versão instalada;
2. busca a tag de destino;
3. confere o caminho de atualização da versão de destino e recusa saltos não permitidos ou
   downgrades;
4. mostra a seção da versão e pede confirmação;
5. faz o backup;
6. troca os arquivos e o `IMAGE_TAG`, baixa as imagens e sobe a stack;
7. confere se a API responde na versão nova.

Use `-y` para pular a confirmação, por exemplo num agendamento. Em instalações mais
antigas que a 1.0.3, que ainda não têm o script, use a atualização manual.

### Manual

```bash
cd /opt/status-page
scripts/backup.sh /opt/backups/status-page
git fetch --tags && git checkout v1.0.3            # compose e Caddyfile da nova versão
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=1.0.3/' .env
docker compose pull
docker compose up -d --no-build --wait
```

Instalações feitas com `git clone --depth 1` também funcionam com `git fetch --tags`.

As migrações rodam sozinhas no serviço `migrate` antes de a API subir. Elas só avançam: um
banco migrado não roda numa versão mais antiga.

## Conferindo

```bash
docker compose ps                                                   # todos "healthy"; migrate "exited (0)"
docker compose exec -T api node -p "require('./package.json').version"
curl -fsS http://localhost/api/readyz                               # {"status":"ok",...}
docker compose logs --since 10m api worker monitor | grep -i error
```

Abra a página pública e o painel e confira um incidente recente.

## Voltando atrás

- **Seção diz "volta sem restaurar backup: sim":** troque o `IMAGE_TAG` e os arquivos para a
  versão anterior e suba de novo:

  ```bash
  git checkout v1.0.2
  sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=1.0.2/' .env
  docker compose pull && docker compose up -d --no-build --wait
  ```

- **Caso contrário:** volte os arquivos e o `IMAGE_TAG` como acima e restaure o backup feito
  antes da atualização:

  ```bash
  scripts/restore.sh /opt/backups/status-page/status-page-<data>
  ```

  O que foi registrado depois do backup (incidentes, assinantes) se perde. Exporte o
  histórico pelo painel antes, se precisar.

## Problemas comuns

| Sintoma                                              | O que fazer |
| ---------------------------------------------------- | ----------- |
| `migrate` termina com erro e a API não sobe          | `docker compose logs migrate`. A migração roda numa transação: corrija a causa (espaço, permissão) e rode `docker compose up -d --no-build --wait` de novo, ou volte atrás restaurando o backup. |
| `pull` falha com `manifest unknown`                  | A versão não existe no registro: confira o número e se a release terminou de publicar. |
| `up --wait` estoura o tempo                          | `docker compose ps` e `docker compose logs <serviço>` do contêiner que não ficou "healthy". |
| `git checkout` recusa por alterações locais          | `git stash`, atualize e reaplique a alteração (ou mova-a para um `compose.override.yaml`). |
| Segredos (SMTP, LDAP, webhooks) deixam de funcionar  | O `APP_SECRET` do `.env` mudou: restaure o `.env` original. |

## Caminhos de atualização

Cada versão tem uma seção com os mesmos campos. Ela é conferida pelo CI e entra nas notas
da release.

### 1.0.3

- **Atualiza a partir de:** 1.0.0 (salto direto de qualquer 1.0.x).
- **Banco de dados:** nenhuma migração nova.
- **Configuração:** só o `IMAGE_TAG` no `.env`. O `compose.yaml` e o `Caddyfile` não mudaram.
- **Ação manual:** nenhuma. Esta é a primeira versão com o `scripts/upgrade.sh`: para chegar
  a ela, use a atualização manual; as próximas podem usar o script.
- **Indisponibilidade:** segundos, durante a recriação dos contêineres.
- **Volta sem restaurar backup:** sim, para a 1.0.2 ou a 1.0.1 (não volte para a 1.0.0, que
  tem falhas críticas).

### 1.0.2

- **Atualiza a partir de:** 1.0.0 (salto direto de qualquer 1.0.x).
- **Banco de dados:** nenhuma migração nova.
- **Configuração:** só o `IMAGE_TAG` no `.env`. O `compose.yaml` e o `Caddyfile` não mudaram.
- **Ação manual:** nenhuma. Se o CSS personalizado de algum tema estiliza os grupos de
  componentes, revise-o: cada grupo agora é um cartão próprio (classes `sp-components` e
  `sp-group`).
- **Indisponibilidade:** segundos, durante a recriação dos contêineres.
- **Volta sem restaurar backup:** sim, para a 1.0.1 (não volte para a 1.0.0, que tem falhas
  críticas).

### 1.0.1

- **Atualiza a partir de:** 1.0.0. **Urgente**: corrige falhas críticas de execução remota
  de código no Next.js.
- **Banco de dados:** nenhuma migração nova.
- **Configuração:** só o `IMAGE_TAG` no `.env`. O `compose.yaml` e o `Caddyfile` não mudaram.
- **Ação manual:** nenhuma.
- **Indisponibilidade:** segundos, durante a recriação dos contêineres.
- **Volta sem restaurar backup:** possível, mas não recomendada (a 1.0.0 é vulnerável).

### 1.0.0

- **Atualiza a partir de:** instalação inicial (veja [INSTALACAO.md](INSTALACAO.md)).
- **Banco de dados:** cria o esquema completo.
- **Configuração:** `.env` a partir do `.env.example`.
- **Ação manual:** nenhuma.
- **Indisponibilidade:** não se aplica.
- **Volta sem restaurar backup:** não se aplica.

## Para quem publica versões

Ao preparar uma versão nova (`X.Y.Z` no `package.json`):

1. Adicione a seção `### X.Y.Z` em [Caminhos de atualização](#caminhos-de-atualização), com
   todos os campos, e a linha na tabela de [Resumo](#resumo).
2. Defina o **Atualiza a partir de**:
   - Normalmente é a mesma versão mínima da seção anterior.
   - Suba a versão mínima e marque a anterior como **parada obrigatória** quando uma
     migração de dados exigir isso, por exemplo uma migração que reescreve dados e só
     funciona a partir do esquema de uma versão específica.
3. Confira o que mudou desde a última tag:

   ```bash
   git diff --stat vANTERIOR -- packages/db/prisma compose.yaml Caddyfile .env.example docker scripts
   ```

   - Migração nova: descreva-a e marque "volta sem restaurar backup: não".
   - Variável nova ou alterada no `.env`, ou mudança no compose e no Caddyfile: diga o que
     fazer.
4. `scripts/upgrade-path.sh check` valida a seção. O CI roda essa conferência e também
   atualiza uma instalação real, com dados, a partir da última release.
5. A release falha se a seção não existir e copia a seção para as notas da release.
