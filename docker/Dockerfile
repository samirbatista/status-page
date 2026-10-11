# syntax=docker/dockerfile:1
# Imagem única do monorepo. Alvos:
#   node-app  — api, worker ou monitor; escolha com --build-arg PACKAGE=@status-page/<app>
#   migrate   — aplica as migrações do banco e executa o seed (idempotente)
#   web       — frontend Next.js (servidor standalone)
#
# Atrás de um proxy com inspeção TLS, informe a CA corporativa no build:
#   docker build --secret id=extra_ca,src=/caminho/ca.crt ...

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm install -g pnpm@10.28.0 && npm cache clean --force
WORKDIR /repo

# Baixa as dependências só a partir do lockfile: esta camada fica em cache
# enquanto o pnpm-lock.yaml não mudar.
FROM base AS source
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .pnpmfile.cjs ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm fetch --store-dir /pnpm/store
COPY . .
# --prefer-offline: os pacotes já estão no store; a rede só é usada por scripts de
# instalação que baixam binários (ex.: engines do Prisma).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm/store

FROM source AS build-node
ARG PACKAGE
RUN test -n "$PACKAGE" || (echo "defina --build-arg PACKAGE=@status-page/<app>" && exit 1)
RUN pnpm turbo run build --filter="${PACKAGE}..."
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm --filter="${PACKAGE}" deploy --prod --legacy --prefer-offline --store-dir /pnpm/store /out

FROM ${NODE_IMAGE} AS node-app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build-node --chown=node:node /out ./
USER node
CMD ["node", "dist/main.js"]

FROM source AS build-migrate
RUN pnpm turbo run build --filter="@status-page/db..."
# Sem --prod: a CLI do Prisma (devDependency) é necessária para aplicar as migrações.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm --filter="@status-page/db" deploy --legacy --prefer-offline --store-dir /pnpm/store /out

FROM ${NODE_IMAGE} AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build-migrate --chown=node:node /out ./
USER node
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/seed.js"]

FROM source AS build-web
RUN pnpm turbo run build --filter="@status-page/web..."

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build-web --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build-web --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
