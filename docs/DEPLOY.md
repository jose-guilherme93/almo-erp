# Deploy — almo-erp em produção (Dokploy)

> **Uma VPS com Dokploy**: aplicação (build pelo `Dockerfile`), Postgres como
> serviço do próprio Dokploy, Traefik fazendo TLS e domínio. As migrations rodam
> **no entrypoint do container**; o seed roda **uma vez** pelo Run Command.

## 1. Como o deploy funciona

| Peça | O que é |
|---|---|
| **CI** (`ci.yml`) | lint, typecheck, testes e build a cada push/PR na `main` |
| **Deploy** (`deploy.yml`) | quando o CI passa, chama o **webhook do Dokploy** |
| **Dokploy** | builda a imagem (Dockerfile) e sobe o container |
| **Migrations** | `prisma migrate deploy` no entrypoint, antes do Next servir |
| **Backup principal** | Dokploy → S3 (agendado, retenção longa) |
| **Backup secundário** | `backup.yml`: SSH → dump dentro do container → **cifrado** → artefato (14 dias) |

```
merge na main
  → CI verde
  → deploy.yml chama o webhook do Dokploy
  → Dokploy builda e sobe
  → entrypoint: pnpm db:deploy && pnpm start
```

O seed **não** roda a cada deploy: é um passo único (ver §5).

## 2. Pré-requisitos (uma vez)

1. **Dokploy instalado** na VPS, com um domínio próprio do painel.
2. **DNS**: registro `A` de `colegiobatista.josetilabs.com` → IP da VPS (o
   Traefik emite o certificado sozinho).
3. **Serviço Postgres** criado no Dokploy (aba *Databases*). Anote usuário, senha,
   banco e o **nome do serviço** na rede interna.
4. **S3 Destination** criada no Dokploy (para o backup principal).
5. **Application** criada apontando para o repositório, com build type
   **Dockerfile**.

## 3. Serviços e configuração no Dokploy

### Application (o app)

- **Build type**: Dockerfile (raiz do repo).
- **Domains**: adicione `colegiobatista.josetilabs.com` (porta 3000).
- **Environment**: preencha conforme `.env.production.example`.
- **Volume**: monte um volume em **`/data/uploads`** (precisa bater com a env
  `UPLOAD_DIR`). É onde os anexos de imagem ficam.
- **Health check**: `http://localhost:3000/api/health`.
- **Replicas**: **1**. **Zero-downtime: desligado.**
- O entrypoint **espera o banco** (até ~60s, por `DB_WAIT_ATTEMPTS` ×
  `DB_WAIT_DELAY_SECONDS`) antes de migrar — evita crash-loop quando a VPS
  reinicia com o Postgres ainda subindo.

> Por que 1 réplica e sem zero-downtime: as migrations rodam no entrypoint. Com
> mais de um container subindo ao mesmo tempo, duas instâncias migrariam juntas.
> **Quando escalar para mais de uma réplica, mova a migration para um serviço
> separado** (`migrate` em Docker Compose) e tire do entrypoint.

### Database (o Postgres)

- **Backups**: agende para a **S3 Destination**, com retenção longa.
- A app conecta pelo nome do serviço: `postgres://…@<servico>:5432/almo_erp`.

## 4. Secrets no GitHub

Settings → Secrets and variables → Actions.

| Secret | Para que |
|---|---|
| `DOKPLOY_WEBHOOK_URL` | disparar o deploy (Dokploy → Application → Deployments → Webhook) |
| `SSH_HOST` | host da VPS (backup por SSH) |
| `SSH_USER` | usuário SSH do backup |
| `SSH_PRIVATE_KEY` | chave privada SSH dedicada ao backup |
| `POSTGRES_CONTAINER` | nome do container do Postgres (veja `docker ps` na VPS) |
| `BACKUP_PASSPHRASE` | passphrase do `gpg` que cifra o dump |

## 5. Primeira subida

1. Deploy da aplicação (pelo pipeline ou pelo botão no Dokploy). O entrypoint
   aplica as migrations e o app sobe.
2. **Seed (uma vez só)** — Dokploy → Application → **Advanced → Run Command**:
   ```bash
   pnpm db:seed
   ```
   Isso cria permissões, papéis, unidades, setores, configurações, a filial
   `MATRIZ` e o administrador. É idempotente e não reescreve a senha depois.
3. Verifique `curl -fsS https://colegiobatista.josetilabs.com/api/health` →
   `{"status":"ok"}` e faça login em `/login` com o `SEED_ADMIN_EMAIL` +
   `SEED_ADMIN_PASSWORD`.

## 6. Backup

- **Principal — Dokploy → S3**: agendado no serviço de banco do Dokploy, retenção
  longa. É o backup de verdade.
- **Secundário — GitHub (`backup.yml`)**: entra por SSH, tira o dump **de dentro**
  do container (o banco nunca é exposto), **cifra com AES256** e guarda como
  artefato por 14 dias. É uma segunda cópia, em outro provedor.

**Restauração** (teste periodicamente num banco descartável):

```bash
# do artefato cifrado:
gpg --batch --yes --passphrase-file <arquivo-com-a-passphrase> \
  -d almo_erp-<data>.dump.gpg > dump

pg_restore -d "postgresql://usuario:senha@host:porta/banco" --clean --if-exists dump
```

Guarde a passphrase fora do GitHub (gerenciador de senhas). Sem ela, o artefato
cifrado é inútil — de propósito.

## 7. Anexos (imagens)

Funcionam: a v1 tem os anexos ligados e o binário fica **no volume** em
`/data/uploads`. O download passa pelo route `/api/anexos/[id]`, que revalida a
visibilidade da solicitação/chamado antes de entregar o arquivo.

> Se o dia chegar em que o volume não servir (múltiplas instâncias, por exemplo),
> o caminho é mover o binário para object storage (Cloudflare R2) — o modelo
> `Attachment` já existe e aceita essa troca.

## 8. Rollback

- **Dokploy → Application → Deployments** permite reverter para uma implantação
  anterior.
- A migration **não** volta sozinha: reverter schema exige uma migration de
  reversão explícita. Por isso prefira migrations **aditivas**.

## 9. Operação

- **Logs**: Dokploy → Application → Logs (ou o serviço de banco).
- **Uptime**: aponte o monitor para `https://<dominio>/api/health`.
- **Disco**: os volumes do Postgres e de uploads crescem — monitore.
- **Firewall**: apenas 22, 80 e 443. O Postgres **não** é exposto.

## 10. Observações

- **Traefik** já vem com o Dokploy; não há Nginx para configurar.
- O `.dockerignore` garante que `.env` e artefatos de teste não entram na imagem.
- A imagem roda `pnpm start` (sem `output: standalone`) para não depender do
  tracing do Prisma.
