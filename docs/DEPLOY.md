# Deploy — almo-erp em produção (Dokploy)

> **Uma VPS com Dokploy**: a aplicação roda a partir de uma **imagem publicada no GHCR**,
> Postgres como serviço do próprio Dokploy, Traefik fazendo TLS e domínio. A imagem é
> construída no GitHub Actions — a VPS **não builda mais**. As migrations rodam no
> **entrypoint do container**; o seed roda **uma vez** pelo Run Command.

## 1. Como o deploy funciona

| Peça | O que é |
|---|---|
| **`pnpm release:publish`** (local) | decide a versão pelos commits, cria a tag `vX.Y.Z` e empurra |
| **`release-image.yml`** | constrói a imagem, publica no GHCR, dispara o deploy e **confere que subiu** |
| **Dokploy** | puxa a imagem pronta do GHCR e sobe — não clona nem builda |
| **Migrations** | `prisma migrate deploy` no entrypoint, antes do Next servir |
| **Backup principal** | Dokploy → S3 (agendado, retenção longa) |
| **Backup secundário** | `backup.yml`: SSH → dump dentro do container → **cifrado** → artefato (14 dias) |

```
pnpm release:publish
  → tag vX.Y.Z
  → Actions: verify (typecheck + test) → build (linux/amd64) → scan (Trivy)
             → assinatura keyless (cosign) + atestação → ghcr.io/<owner>/almo-erp:vX.Y.Z (+ :latest)
  → Actions entra na tailnet, aponta a Application para vX.Y.Z (application.saveDockerProvider)
    e chama POST /api/application.deploy
  → Dokploy puxa a imagem e sobe
  → entrypoint: espera o banco → pnpm db:deploy → pnpm start
  → Actions confere /api/health até a versão nova responder
```

O seed **não** roda a cada deploy: é um passo único (ver §5).

**O portão de qualidade fica antes do merge, não no deploy.** O hook `pre-push` roda
`lint + typecheck + test + build` localmente, e o E2E roda no PR (`e2e.yml`) — que é a única
camada que prova o caminho pela interface. O PR de release vai da `develop` para a `main`, e ele
também roda o E2E (ver `AGENTS.md` §9.1, §9.4 e §10.1).

### Por que a imagem é construída no CI, e não na VPS

Antes o Dokploy clonava o repositório e rodava `pnpm install && next build` **no servidor**: um
build pesado numa VPS de 2 vCPU que já está servindo o ERP. O build competia com a aplicação.

Agora o runner do GitHub (4 vCPU, descartável) constrói, e a VPS só puxa. O cache de camadas do
GHA evita reinstalar as dependências a cada release.

### Por que o deploy é disparado pelo runner, e não por webhook

O painel do Dokploy desta instalação vive **atrás do Tailscale** — nada na internet o alcança. Isso
elimina o auto deploy por webhook: nem o GitHub nem o Docker Hub conseguem chamá-lo.

A saída é o runner entrar na tailnet como nó **efêmero** (tag `tag:ci`) e chamar a API por dentro.
A ACL limita essa tag a alcançar **só** o host do Dokploy, na porta do painel.

> Se um dia o Dokploy ganhar endereço público, o caminho mais simples é trocar o passo do
> Tailscale por um `curl` direto — o resto do fluxo não muda.

### O que é congelado no build

**Um `NEXT_PUBLIC_*` só é inlinado se o código do navegador o ler.** Foi conferindo isso que
descobrimos que só **um** importa:

| Variável | Quando vale | Se faltar no build |
|---|---|---|
| `GIT_SHA` (build arg) | build | `/api/health` responde `unknown` — foi o que aconteceu na `1.2.0` |
| `NEXT_PUBLIC_SENTRY_DSN` (build arg) | build | **a captura de erro do navegador fica silenciosamente morta** |

E as que **não** são build arg, apesar do nome:

| Variável | Quando vale | Por quê |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | **runtime** | é lida num Server Component e passada como prop — o navegador nunca a lê direto |
| `NEXT_PUBLIC_APP_URL` / `APP_NAME` | não é lida | só existem no schema de `src/lib/env.ts`; ninguém consome |
| `DATABASE_URL`, `AUTH_SECRET`… | runtime | segredos de container, vão no Environment do Dokploy |

> A armadilha é real e silenciosa: um `--build-arg` que o `Dockerfile` não declara é
> **ignorado**, e o `next build` congela o vazio. Não falha — mente. Por isso o único
> `NEXT_PUBLIC_*` que o cliente lê tem `ARG` declarado no `Dockerfile`, com comentário dizendo
> por quê.
>
> `NEXT_PUBLIC_APP_URL` continua sendo usada — mas **pelo workflow**, como alvo da conferência de
> health depois do deploy. Não é build arg.

## 2. Pré-requisitos (uma vez)

1. **Dokploy instalado** na VPS, acessível pela tailnet.
2. **DNS**: registro `A` de `colegiobatista.josetilabs.com` → IP da VPS (o
   Traefik emite o certificado sozinho). A **aplicação** é pública; o **painel** é só tailnet.
3. **Serviço Postgres** criado no Dokploy (aba *Databases*). Anote usuário, senha,
   banco e o **nome do serviço** na rede interna.
4. **S3 Destination** criada no Dokploy (para o backup principal).
5. **Token do GHCR** para o Dokploy puxar a imagem: um PAT do GitHub com `read:packages`
   (fine-grained ou classic). Guarde — ele vai na Application (§3) **e** nos secrets do GitHub
   (`GHCR_USERNAME` + `GHCR_TOKEN`), porque o workflow reafirma essa credencial ao apontar a
   Application para a versão nova.
6. **Cliente OAuth do Tailscale** para o CI, com a tag `tag:ci`, e uma **ACL** que permita
   `tag:ci` alcançar o host do Dokploy na porta do painel. Gere em
   Tailscale → Settings → OAuth clients.
7. **Application** criada com origem **Docker / registry** (§3) — não mais por Git.

## 3. Serviços e configuração no Dokploy

### Application (o app)

- **Source**: **Docker** (registry) — **não** Git. É isso que faz a VPS parar de buildar.
- **Docker Image**: `ghcr.io/<owner>/almo-erp:vX.Y.Z` — a **tag imutável** da versão em produção.
  O `release-image.yml` reescreve este campo a cada release (`application.saveDockerProvider`)
  antes de deployar, então você não precisa editar à mão. O Dokploy **não adivinha** a tag.
- **Registry URL**: `ghcr.io` · **Username**: seu usuário do GitHub ·
  **Password**: o PAT com `read:packages` do §2.5
- **Auto Deploy**: **desligado**. Quem dispara é o `release-image.yml`, pela API.
- **Domains**: `colegiobatista.josetilabs.com` (porta 3000).
- **Environment**: preencha conforme `.env.production.example`. Aqui vão os **segredos de
  runtime** (`DATABASE_URL`, `AUTH_SECRET`…) — e **não** os `NEXT_PUBLIC_*`, que são de build.
- **Volume**: monte um volume em **`/data/uploads`** (precisa bater com `UPLOAD_DIR`).
- **Health check**: `http://localhost:3000/api/health`.
- **Replicas**: **1**. **Zero-downtime: desligado.**
- O entrypoint **espera o banco** (até ~60s, por `DB_WAIT_ATTEMPTS` × `DB_WAIT_DELAY_SECONDS`)
  antes de migrar — evita crash-loop quando a VPS reinicia com o Postgres ainda subindo.

> **Por que 1 réplica e sem zero-downtime — e por que o banco nunca atende dois containers.**
>
> As migrations rodam no **entrypoint**, não num passo separado. Com 1 réplica e zero-downtime
> **desligado**, o Dokploy faz **para o container antigo → sobe o novo**: há uma janela de alguns
> segundos de indisponibilidade, e **um único container fala com o Postgres por vez**.
>
> O banco **conseguiria** atender dois — Postgres é cliente/servidor e aceita centenas de conexões;
> não é recurso de uso exclusivo. O que impede dois **não é capacidade do banco**, é a estratégia
> de deploy: dois containers subindo juntos rodariam `prisma migrate deploy` ao mesmo tempo. O
> Prisma usa *advisory lock*, então não corromperia — mas não vale depender disso.
>
> **A virada de Dockerfile para imagem não cria um segundo servidor.** É mudança de *fonte* na
> **mesma** Application (Dockerfile → Docker image): o mesmo slot, com container novo.
>
> **O único jeito de dois servidores no mesmo banco** é apontar **duas Applications** para a mesma
> `DATABASE_URL` — por exemplo, o preview com o banco de produção, o que ainda misturaria dados de
> demonstração com dados reais. A regra: **uma `DATABASE_URL`, uma Application.**
>
> **Antes de ligar o zero-downtime**, mova a migration para um passo separado e tire do entrypoint.
> Enquanto ela estiver aqui, o zero-downtime sobe o novo **antes** de matar o velho, e dois
> containers migrariam juntos. Migration **aditiva** (nunca `DROP COLUMN` no mesmo deploy) é o que
> torna até uma sobreposição breve inofensiva. E **tire um backup antes de qualquer virada** — é o
> botão de pânico.

> Sobre a tag: a Application fica na **imutável** (`v1.3.0`), não em `:latest`. É o workflow que
> a atualiza para a versão nova a cada release — assim produção nunca "muda sozinha", e o
> rollback é trocar a tag para a anterior (§8). O `:latest` existe só para preview/conveniência.

### Database (o Postgres)

- **Backups**: agende para a **S3 Destination**, com retenção longa.
- A app conecta pelo nome do serviço: `postgres://…@<servico>:5432/almo_erp`.

## 4. Secrets e variáveis no GitHub

Settings → Secrets and variables → Actions.

**Secrets** (não aparecem em log):

| Secret | Para que |
|---|---|
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | o runner entrar na tailnet |
| `DOKPLOY_API_KEY` | `application.saveDockerProvider` + `application.deploy` |
| `GHCR_USERNAME` / `GHCR_TOKEN` | credencial de pull do GHCR reafirmada na Application (usuário do GitHub + PAT `read:packages`) |
| `SSH_HOST` / `SSH_USER` / `SSH_PRIVATE_KEY` | backup por SSH |
| `POSTGRES_CONTAINER` | nome do container do Postgres (veja `docker ps` na VPS) |
| `BACKUP_PASSPHRASE` | passphrase do `gpg` que cifra o dump |

**Variables** (visíveis; e são públicas por natureza, porque vão para o bundle):

| Variable | Para que |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | **build arg** — sem ele não há captura de erro no navegador |
| `NEXT_PUBLIC_APP_URL` | alvo da conferência de health depois do deploy (**não** é build arg) |
| `DOKPLOY_URL` | endereço do painel na tailnet (ex.: `http://<host>:3000`) |
| `DOKPLOY_APPLICATION_ID` | id da Application (Dokploy → Advanced) |

> Um DSN do Sentry **não é segredo**: ele vai embutido no JavaScript do navegador de qualquer
> forma. Por isso é variable, não secret.

## 5. Primeira subida

1. Rode `pnpm release:publish` (ou publique a imagem à mão pelo `release-image.yml`) e clique
   **Deploy** no Dokploy. O entrypoint espera o banco, aplica as migrations e o app sobe.
2. **Seed (uma vez só)** — Dokploy → Application → **Advanced → Run Command**:
   ```bash
   pnpm db:seed
   ```
   Isso cria permissões, papéis, unidades, setores, configurações, a filial `MATRIZ` e o
   administrador. É idempotente e não reescreve a senha depois.
3. Verifique `curl -fsS https://colegiobatista.josetilabs.com/api/health` →
   `{"status":"ok","version":"1.3.0+abc1234","commit":"abc1234","builtAt":"…"}` e faça login em
   `/login` com o `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`.

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

- **Imagem**: cada release publica uma tag **imutável** (`v1.3.0`), então voltar é trocar o
  **Docker Image** da Application para a versão anterior e clicar em Deploy. Nada é reconstruído.
- **Dokploy → Application → Deployments** também permite reverter para uma implantação anterior.
- A migration **não** volta sozinha: reverter schema exige uma migration de reversão explícita.
  Por isso prefira migrations **aditivas**.

> É por isso que `:latest` **não** é o único destino: sem a tag imutável, "voltar para a versão
> de ontem" não teria para onde apontar.

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
- A imagem é construída **no CI** (`release-image.yml`) e a VPS só puxa. O Dockerfile continua
  sendo a fonte da verdade do runtime — ele só não é mais executado no servidor.
- `NEXT_PUBLIC_*` é congelado no build: mudar essas variáveis exige **nova imagem**, não um
  restart do container. As de runtime (banco, `AUTH_SECRET`) bastam um restart.

## 11. Preview (ambiente de demonstração) × produção

No Dokploy isso são **duas Applications** apontando para o mesmo repositório, cada uma com o seu
banco — **nunca a mesma `DATABASE_URL`** (um banco, uma Application; ver §3). Uma nunca enxerga a
outra.

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
2. Crie uma **segunda Application**, origem **Docker / registry**:
   - **Docker Image**: `ghcr.io/<owner>/almo-erp:edge` (a tag do preview; ver abaixo)
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

### Atualizar o preview

O `release-image.yml` **não** roda sozinho fora de tag: preview é demonstração, e construir a cada
push na `develop` consumiria minutos sem ninguém pedir. Para atualizar:

1. Actions → **Release da imagem (GHCR)** → *Run workflow* na branch `develop`.
   Isso publica `ghcr.io/<owner>/almo-erp:edge` (sem tocar em `:latest` e sem deployar produção).
2. Dokploy → Application do preview → **Deploy** (ele puxa a `:edge` nova).

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

## 12. Roteiro: validar a imagem antes da virada de produção

O objetivo é provar o **pipeline inteiro** (build → testes → scan → assinatura → atestação) e a
**imagem** num ambiente descartável — o **preview** — antes de qualquer coisa tocar produção.

### Pré-requisitos (uma vez)

- **`NEXT_PUBLIC_APP_URL`** definida como *variable*. Mesmo para `:edge`, o build **confere que ela
  existe** e falha antes de construir sem ela.
- O **preview** já montado (§11), com **o próprio Postgres** e **o próprio volume**.
- Opcional: `NEXT_PUBLIC_SENTRY_DSN` (build arg).

> O job de **deploy** (Tailscale + Dokploy) **não roda** aqui: ele só executa em tag de release
> (`v*`). Então validar o `:edge` **não** exige `TS_OAUTH_*` nem `DOKPLOY_*`.

### Passo 1 — Publicar `:edge`

```bash
gh workflow run release-image.yml --ref develop
gh run list --workflow=release-image.yml --limit 1
gh run watch <run-id>          # acompanha até o fim
```

O run faz: **`verify`** (typecheck + `test`) → **build** (linux/amd64) → **Trivy** → **cosign** →
**atestação**. O job `deploy` é **pulado** (não é release). Se o Trivy achar `CRITICAL`/`HIGH`, o
run falha aqui — a imagem é publicada, mas nunca vai a lugar nenhum.

### Passo 2 — Conferir a imagem e a assinatura

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <usuario-github> --password-stdin
docker pull ghcr.io/<owner>/almo-erp:edge
docker inspect --format '{{index .RepoDigests 0}}' ghcr.io/<owner>/almo-erp:edge

# procedência (troque <owner>)
gh attestation verify oci://ghcr.io/<owner>/almo-erp:edge -R <owner>/almo-erp
```

- `<owner>` = dono do repositório; `<usuario-github>` = seu usuário; `GHCR_TOKEN` = PAT com
  `read:packages`.
- A `docker inspect` devolve o **digest** exato — é o que você compararia depois, se quisesse.

### Passo 3 — Subir no preview

1. Dokploy → Application do **preview** → **Docker Image** = `ghcr.io/<owner>/almo-erp:edge` → **Deploy**.
2. `curl -fsS https://<dominio-preview>/api/health` → `"status":"ok"` e o `commit` igual ao que
   você acabou de publicar.
3. Fumaça manual: entrar (`admin.<local>@<dominio>`) e abrir `/solicitacoes`, `/estoque/saldos`,
   `/patrimonio`.

### Passo 4 — Só então a virada de produção

1. Abra o **PR `develop → main`** (o E2E roda nele — é o portão).
2. Merge na `main`.
3. `pnpm release:publish` — decide a versão pelos commits, cria a tag `vX.Y.Z` e sobe `main` + tag.
4. O `release-image.yml` (na tag) constrói, escaneia e assina; **aponta a Application de produção
   para `vX.Y.Z`** e dispara o deploy; depois **confere o `/api/health`** até a versão nova responder.
5. Acompanhe: `gh run watch <run-id>`.

> **A primeira virada tem um passo manual:** trocar a origem da Application de produção de
> **Dockerfile** para **Docker image** (§3), com a imagem `ghcr.io/<owner>/almo-erp:vX.Y.Z` da
> versão que já está no ar, `Auto Deploy` desligado e as credenciais do GHCR. Depois disso é a
> automação que mantém a tag.

### Se algo der errado

- **Scan falhou / imagem ruim:** o job falha e o **deploy não acontece**. Corrija e republique.
- **Rollback de produção:** Dokploy → Application → **Docker Image** = `vX.Y.Z` anterior → Deploy →
  confira `/api/health`. Nada é reconstruído (§8).
- **Preview quebrado:** produção **não** é afetada — banco e volume são próprios (§11).
