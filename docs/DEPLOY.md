# Deploy — almo-erp em produção (Dokploy)

> **Uma VPS com Dokploy**: aplicação (build pelo `Dockerfile`), Postgres como
> serviço do próprio Dokploy, Traefik fazendo TLS e domínio. As migrations rodam
> **no entrypoint do container**; o seed roda **uma vez** pelo Run Command.

## 1. Como o deploy funciona

| Peça | O que é |
|---|---|
| **Auto Deploy** (Dokploy) | push na `main` → Dokploy builda (Dockerfile) e sobe |
| **CI** (`ci.yml`) | lint, typecheck, testes e build a cada push/PR na `main` |
| **Migrations** | `prisma migrate deploy` no entrypoint, antes do Next servir |
| **Backup principal** | Dokploy → S3 (agendado, retenção longa) |
| **Backup secundário** | `backup.yml`: SSH → dump dentro do container → **cifrado** → artefato (14 dias) |

```
push na main
  → Dokploy (Auto Deploy) builda e sobe
  → entrypoint: espera o banco → pnpm db:deploy → pnpm start
  → CI roda em paralelo (qualidade)
```

O seed **não** roda a cada deploy: é um passo único (ver §5).

**O portão de qualidade fica antes do push**, não no deploy: o hook `pre-push` roda
`lint + typecheck + test + build` e o CI roda no PR para a `main`. O Auto Deploy publica
o que chega na `main` — então o hábito é **abrir PR e mergear só com o CI verde**, em vez
de empurrar direto.

## 2. Pré-requisitos (uma vez)

1. **Dokploy instalado** na VPS, com um domínio próprio do painel.
2. **DNS**: registro `A` de `colegiobatista.josetilabs.com` → IP da VPS (o
   Traefik emite o certificado sozinho).
3. **Serviço Postgres** criado no Dokploy (aba *Databases*). Anote usuário, senha,
   banco e o **nome do serviço** na rede interna.
4. **S3 Destination** criada no Dokploy (para o backup principal).
5. **Application** criada apontando para o repositório (build type **Dockerfile**),
   branch **`main`** e **Auto Deploy ligado**.

## 3. Serviços e configuração no Dokploy

### Application (o app)

- **Build type**: Dockerfile (raiz do repo).
- **Branch**: **`main`** (a `develop` é só para testes; produção acompanha a `main`).
- **Auto Deploy**: **ligado** — todo push na `main` builda e sobe.
- **Domains**: adicione `colegiobatista.josetilabs.com` (porta 3000).
- **Environment**: preencha conforme `.env.production.example`.
- **Volume**: monte um volume em **`/data/uploads`** (precisa bater com a env
  `UPLOAD_DIR`). É onde os anexos de imagem ficam.
- **Health check**: `http://localhost:3000/api/health`.
- **Replicas**: **1**. **Zero-downtime: desligado.**
- O entrypoint **espera o banco** (até ~60s, por `DB_WAIT_ATTEMPTS` ×
  `DB_WAIT_DELAY_SECONDS`) antes de migrar — evita crash-loop quando a VPS
  reinicia com o Postgres ainda subindo.
- **Versão exibida**: o build injeta `semver+SHA` (do `package.json` + commit). Para o SHA
  aparecer, passe o build arg `GIT_SHA` (ex.: `--build-arg GIT_SHA=$(git rev-parse --short HEAD)`);
  sem ele o commit fica `unknown`, mas o semver e a data continuam. A versão sai em
  `/api/health`, no cabeçalho `X-App-Version` e no rodapé da sidebar.

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
| `SSH_HOST` | host da VPS (backup por SSH) |
| `SSH_USER` | usuário SSH do backup |
| `SSH_PRIVATE_KEY` | chave privada SSH dedicada ao backup |
| `POSTGRES_CONTAINER` | nome do container do Postgres (veja `docker ps` na VPS) |
| `BACKUP_PASSPHRASE` | passphrase do `gpg` que cifra o dump |

## 5. Primeira subida

1. Deploy da aplicação (push na `main` ou pelo botão no Dokploy). O entrypoint
   espera o banco, aplica as migrations e o app sobe.
2. **Seed (uma vez só)** — Dokploy → Application → **Advanced → Run Command**:
   ```bash
   pnpm db:seed
   ```
   Isso cria permissões, papéis, unidades, setores, configurações, a filial
   `MATRIZ` e o administrador. É idempotente e não reescreve a senha depois.
3. Verifique `curl -fsS https://colegiobatista.josetilabs.com/api/health` →
   `{"status":"ok","version":"0.1.0+abc1234","commit":"abc1234","builtAt":"…"}` e faça login
   em `/login` com o `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`.

> Quer um ambiente de **preview** com dados de demonstração? Veja §11.

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

## 11. Preview (ambiente de demonstração) × produção

No Dokploy isso são **duas Applications** apontando para o mesmo repositório, cada
uma com o seu banco. Uma nunca enxerga a outra.

| | **Produção** | **Preview** |
|---|---|---|
| Branch | `main` | `develop` |
| Banco | Postgres de produção | **outro** Postgres |
| Volume | `/data/uploads` | outro volume |
| Domínio | `colegiobatista.josetilabs.com` | domínio próprio **ou** o gerado pelo Dokploy (`traefik.me`) |
| `AUTH_SECRET` | o de produção | **diferente** |
| `SEED_DEMO_DATA` | **ausente** (nunca `true`) | **`true`** |
| Conteúdo do banco | referência + matriz + admin | + empresa, filiais, catálogo e usuários de demonstração |

### Como montar o preview

1. Crie um **segundo serviço Postgres** (aba *Databases*) — separado da produção.
2. Crie uma **segunda Application**, mesmo repo, build **Dockerfile**:
   - **Branch**: `develop`
   - **Domains**: um domínio de preview (o Dokploy gera um `traefik.me` se você não tiver DNS)
   - **Volume**: um volume próprio montado em `/data/uploads`
   - **Replicas**: 1 · **Zero-downtime**: desligado · **Health check**: `/api/health`
3. Env do preview — o mesmo que produção, com **três diferenças**:
   - `DATABASE_URL` → o Postgres do preview
   - `AUTH_URL` e `NEXT_PUBLIC_APP_URL` → o domínio do preview
   - `AUTH_SECRET` → um valor **diferente** do de produção
   - **`SEED_DEMO_DATA="true"`** ← é isso que liga a demonstração
   - `SEED_DEMO_PASSWORD="<senha-forte>"` (opcional; padrão `demo-senha-1234`)
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (o admin do preview)
4. Deploy. Depois, **uma vez**, o Run Command: `pnpm db:seed`.

Isso cria a demonstração completa (empresa, 3 filiais, 6 categorias, 15 materiais e 6
usuários) — **todos os usuários com senha**, então dá para entrar em cada papel.

### Entrar no preview

Os e-mails de demonstração usam o primeiro domínio de `AUTH_ALLOWED_DOMAINS`
(padrão `exemplo.com.br`). A senha é a `SEED_DEMO_PASSWORD` (padrão `demo-senha-1234`).

| E-mail | Papel |
|---|---|
| `admin.<local>@<dominio>` — veja `SEED_ADMIN_EMAIL` | SUPER_ADMIN |
| `admin.filial@<dominio>` | ADMIN_FILIAL (FIL-SP) |
| `gestor@<dominio>` | GESTOR |
| `almoxarife@<dominio>` | ALMOXARIFE |
| `ti@<dominio>` | TI |
| `solicitante@<dominio>` | SOLICITANTE |
| `consulta@<dominio>` | CONSULTA |

> **Cuidado**: `SEED_DEMO_DATA=true` **jamais** vai na Application de produção — senão
> a produção ganha empresa, filial e catálogo falsos. Em produção a variável fica
> **ausente**.
