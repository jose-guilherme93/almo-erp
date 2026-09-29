# Deploy — almo-erp em produção

> VPS única com Docker: **app (Next) + Postgres 17 + Caddy no mesmo host**.
> Os anexos ficam num volume (`UPLOAD_DIR=/data/uploads`) e o banco em outro;
> o TLS é automático pelo Caddy. Este é o encaixe que o projeto já assume
> (`.gitignore` reserva `/var/uploads/` para o volume externo).

## 1. Pré-requisitos

- VPS com Docker + Docker Compose v2. Dimensionamento sugerido: **2 vCPU / 4 GB** (o
  Postgres e o Next dividem o host).
- Firewall liberando apenas **80** e **443**. O Postgres **não** publica porta.
- Domínio com registro `A` apontando para o IP.
- Credencial OAuth do Google com redirect
  `https://<dominio>/api/auth/callback/google`.

## 2. Arquivos de deploy

| Arquivo | Função |
|---|---|
| `Dockerfile` | Build multi-stage; runtime roda `pnpm start` como usuário `node` |
| `.dockerignore` | Mantém segredos e artefatos fora da imagem |
| `docker-compose.prod.yml` | `postgres` + `app` + `caddy`, com healthchecks e volumes |
| `Caddyfile` | TLS automático e proxy para `app:3000` |
| `scripts/backup-db.sh` | Dump diário + retenção + cópia offsite |

## 3. Segredos (`.env.production`)

Fica no servidor, **fora do git**, com `chmod 600`. O Compose interpola as
variáveis a partir dele (`--env-file .env.production`), então ele serve tanto
para o build quanto para o container.

```dotenv
# ---------- Domínio / build ----------
DOMAIN="erp.suaempresa.com.br"
NEXT_PUBLIC_APP_NAME="almo-erp"
NEXT_PUBLIC_APP_URL="https://erp.suaempresa.com.br"

# ---------- Banco ----------
POSTGRES_USER="almo"
POSTGRES_PASSWORD="<senha-forte>"
POSTGRES_DB="almo_erp"
DATABASE_URL="postgresql://almo:<senha-forte>@postgres:5432/almo_erp?schema=public"

# ---------- Autenticação ----------
AUTH_SECRET="<openssl rand -base64 32>"
AUTH_URL="https://erp.suaempresa.com.br"
AUTH_TRUST_HOST="true"
AUTH_GOOGLE_ID="<client id>"
AUTH_GOOGLE_SECRET="<client secret>"
AUTH_ALLOWED_DOMAINS="suaempresa.com.br"

# ---------- Anexos ----------
UPLOAD_DIR="/data/uploads"

# ---------- Bootstrap do 1º admin ----------
SEED_ADMIN_EMAIL="admin@suaempresa.com.br"
SEED_ADMIN_NAME="Administrador da Matriz"

# ---------- Regras de negócio (opcionais) ----------
SLA_APPROVAL_HOURS="24"
STOCK_BELOW_MIN_DEDUP_DAYS="7"
MATRIX_APPROVAL_THRESHOLD="1000.00"

# ---------- Testes: SEMPRE desligado em produção ----------
# A aplicação recusa subir com E2E_AUTH_BYPASS=true em produção (src/lib/env.ts).
E2E_AUTH_BYPASS="false"
```

> O `SEED_ADMIN_EMAIL` precisa ser de um domínio permitido em
> `AUTH_ALLOWED_DOMAINS` **e** ter uma conta Google real — o login é por Google.

## 4. Primeira subida

```bash
cd /opt/almo-erp
git clone <repo> .            # ou copie o projeto
vim .env.production           # preencha os segredos
chmod 600 .env.production

# Sobe só o banco para aplicar schema
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres

# Aplica migrations
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app pnpm db:deploy

# Bootstrap: papéis, filiais, catálogo, políticas e o 1º admin.
# Em NODE_ENV=production o seed pula os usuários de demonstração.
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app pnpm db:seed

# Sobe a aplicação + proxy
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Verifique:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS https://erp.suaempresa.com.br/api/health   # {"status":"ok"}
```

## 5. Atualização

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml build app
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app pnpm db:deploy
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

- **Nunca** use `prisma db push` em produção.
- Trocar `NEXT_PUBLIC_APP_URL` exige **rebuild** (o valor é inlinado no bundle).
- Rollback: versione a imagem por SHA (`docker build -t almo-erp:<sha>`) e suba a
  tag anterior; a migration só volta com uma migration de reversão explícita.

## 6. Backup e restauração

```bash
# Dump manual
./scripts/backup-db.sh

# Cron diário às 3h (exemplo)
0 3 * * * cd /opt/almo-erp && ./scripts/backup-db.sh >> /var/log/almo-erp-backup.log 2>&1
```

- Defina `RCLONE_REMOTE` no ambiente do cron para copiar o dump para fora do host
  (Cloudflare R2 / Backblaze B2 / S3). Backup que mora só no host não é backup.
- **Teste a restauração** periodicamente (ver comando comentado no topo de
  `scripts/backup-db.sh`) num banco descartável.
- O volume de uploads (`almo-erp-prod-uploads`) precisa entrar no mesmo ciclo de
  backup (por exemplo, snapshot do provedor ou `rclone sync`).

## 7. Operação

- **Logs**: `docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app`.
- **Healthcheck**: container bate em `/api/health` (fora do gate de sessão).
  Aponte também um monitor externo de uptime para a mesma URL.
- **Disco**: o volume de uploads e o `pgdata` crescem; monitore espaço.
- **Segurança**: `AUTH_SECRET` novo, Postgres sem porta exposta, container não-root,
  firewall só 80/443, HSTS já vem no `next.config.ts`.

## 8. Decisões e armadilhas

- **App e banco no mesmo host**: mais simples e barato, mas o host é ponto único de
  falha. Mitigue com backup offsite + snapshot do provedor. Se um dia precisar de
  HA, mova o Postgres para gerenciado (Neon/Supabase) e mantenha só o app no VPS.
- **`pnpm start`, não `output: standalone`**: o standalone com Prisma 7 tem arestas
  de tracing; a imagem é maior, mas previsível.
- **Seed em produção**: roda **uma vez** como bootstrap (pula usuários de demo).
  Divergência consciente do item da FASE 13 que dizia "seed não roda em produção".
- **E2E**: é local-first. `E2E_AUTH_BYPASS` é recusado em produção, então o E2E nunca
  roda contra este container de produção (ver `AGENTS.md §9.1`).
- **Anexos em disco**: funcionam porque há volume persistente. Em serverless (Vercel)
  seria preciso trocar por object storage.
