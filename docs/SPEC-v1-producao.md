# SPEC — v1 em produção (Dokploy na VPS)

> Plano de execução da v1. Serve para retomar com contexto limpo.
> Infra decidida: **uma VPS com Dokploy** (Traefik incluído) + **Postgres como serviço
> do Dokploy** + **Dockerfile** buildado pelo Dokploy.

## Problem Statement

O `almo-erp` está funcional e com os gates verdes, mas **ainda não está em produção**.
É um ERP interno usado por ~100 pessoas/semana, com dados **auditados, sem margem para
erro ou perda de dados**. Ele precisa:

- subir como um processo Node (é Next.js com Server Components/Actions — não é site
  estático), atrás de TLS e domínio próprio;
- **deploy automático** a partir do merge na `main`, sem ninguém entrar na máquina;
- **migrations** aplicadas antes da versão nova atender;
- **backup confiável** e restaurável;
- **anexos de imagem** funcionando;
- primeiro acesso **sem depender do Google** (login local).

## Solution

Publicar a aplicação numa **VPS com Dokploy**: o Dokploy builda o `Dockerfile`, sobe o
container atrás do Traefik (TLS automático) e hospeda o Postgres como serviço, com
backup agendado para S3. As **migrations rodam no entrypoint** do container (1 réplica,
zero-downtime desligado). O **seed** roda **uma vez**, pelo *Run Command* do Dokploy.
O **deploy** é disparado pelo GitHub Actions (webhook do Dokploy) **depois** do CI passar.
Há uma **segunda cópia de backup, cifrada (AES256)**, guardada como artefato do GitHub.
Os **anexos** ficam num volume persistente.

## User Stories

1. Como responsável, quero que o merge na `main` publique sozinho, para não operar servidor.
2. Como responsável, quero que as migrations rodem antes de a versão nova atender.
3. Como responsável, quero que o deploy só dispare com o CI verde.
4. Como responsável, quero backup automático offsite, para não perder dados.
5. Como responsável, quero uma segunda cópia cifrada em outro provedor, para não depender de um só.
6. Como responsável, quero conseguir reverter para uma implantação anterior.
7. Como super admin, quero entrar com e-mail e senha, sem depender do Google.
8. Como super admin, quero ligar/desligar o login por configuração.
9. Como super admin, quero o seed criando a matriz e o meu usuário, uma vez.
10. Como super admin, quero cadastrar empresa, filiais e catálogo pela interface.
11. Como operador, quero enviar fotos nos pedidos/chamados, e vê-las no detalhe.
12. Como operador, quero que as fotos só sejam acessíveis a quem enxerga a demanda.
13. Como operador, quero login por senha protegido contra força bruta.
14. Como operador, quero HTTPS com domínio próprio, para usar no celular/tablet.
15. Como responsável, quero um healthcheck para monitorar uptime.
16. Como desenvolvedor, quero o E2E local continuando verde.
17. Como desenvolvedor, quero que a doc (`AGENTS`, `ARQUITETURA`, `DEPLOY`, `HANDOFF`) reflita a infra real.
18. Como responsável, quero saber exatamente quais segredos preencher e onde.

## Implementation Decisions

- **Plataforma**: Dokploy na VPS (Traefik embutido). Aplicação como *Application* com
  build type **Dockerfile**; Postgres como serviço *Database* do Dokploy; **S3
  Destination** para o backup principal.
- **Anexos ligados**: o binário fica num **volume** montado em `/data/uploads`
  (`UPLOAD_DIR`), servido pelo route `/api/anexos/[id]`, que revalida a visibilidade da
  demanda pai. O modelo `Attachment` já existia. *(Decidido: sem object storage na v1; R2
  fica para o caso de múltiplas instâncias.)*
- **Migrations no entrypoint**: o container roda `prisma migrate deploy` e só então
  `pnpm start`. Seguro com **1 réplica** e **zero-downtime desligado**. Gatilho de
  mudança: ao escalar para mais de uma réplica, mover a migration para um serviço
  `migrate` separado.
- **Seed uma vez**: pelo *Run Command* do Dokploy (`pnpm db:seed`). Em produção cria
  apenas referência (permissões, papéis, unidades, setores, configs), uma filial matriz
  e o admin — **sem** dados de demonstração. Idempotente; não reescreve a senha.
- **Deploy**: o `deploy.yml` chama o **webhook do Dokploy** quando o CI passa na `main`.
  O Dokploy **não** auto-deploya por push (para não competir com o pipeline).
- **Backup**: principal = **Dokploy → S3** (retenção longa). Secundário = workflow que
  entra por **SSH**, tira o dump **de dentro do container do Postgres** (o banco não é
  exposto), **cifra com AES256** e guarda como artefato (retenção curta).
- **Login local** (e-mail + senha) permanece; Google opcional e desligado.
- **Infra de Vercel/Neon descartada**: `DIRECT_URL` deixa de ser necessária (não há
  pooler no Dokploy), os segredos `VERCEL_*` saem.

## Testing Decisions

- **Bom teste** valida comportamento externo. Regras puras (política de e-mail, freio de
  login, hash de senha) testadas sem banco; serviços testados contra o banco; fluxos no E2E.
- **E2E local-first** (Playwright): solicitação, estoque, inventário, relatórios, login
  local e smoke. Rodar com `E2E_AUTH_BYPASS=true pnpm e2e --project=chromium`.
- **Anexos**: o E2E não cobre upload (o volume é ambiente de produção); a cobertura é a
  validação de acesso do route (mesma visibilidade da demanda).
- **Backup**: validar rodando o workflow uma vez e conferindo o artefato cifrado; a
  restauração é testada manualmente (documentada no `docs/DEPLOY.md`).

## Out of Scope

- Object storage (R2) — só se o volume deixar de servir.
- Staging / pré-produção.
- Login com Google em produção (sem credencial).
- E-mail SMTP e exportação para Drive.
- Multi-réplica / zero-downtime (exigiria mover a migration para fora do entrypoint).
- Gestão de senha pela administração (pendência conhecida).

## Further Notes

- A cópia do GitHub **não** é independente da VPS (o dump sai dela) — é independência de
  **onde o arquivo fica**. O Dokploy → S3 é o backup de verdade.
- Guardar a `BACKUP_PASSPHRASE` fora do GitHub é obrigatório: sem ela o artefato é inútil.

---

## Estado de execução (handoff)

### Feito e verificado

- Revertidos os anexos (upload, galeria, `/api/anexos/[id]`, compressão) via `git restore`.
- `Dockerfile` restaurado com **entrypoint de migration** (`pnpm db:deploy && pnpm start`).
- `deploy.yml` reescrito para chamar o **webhook do Dokploy**; `backup.yml` reescrito
  (SSH + dump no container + **gpg AES256** + artefato).
- `.env.production.example` reescrito para Dokploy; doc de deploy reescrita.
- `README`, `AGENTS §9.1`, `HANDOFF`, `ARQUITETURA`, `FASE-13`, `FASE-16` atualizados.

### O que falta (operador)

1. Dokploy instalado + domínio do painel; DNS `A` de `colegiobatista.josetilabs.com`.
2. Serviço **Postgres** no Dokploy + **S3 Destination** + backup agendado.
3. **Application**: repo, build Dockerfile, domínio, volume `/data/uploads`, env (ver
   `.env.production.example`), **replicas=1**, **zero-downtime off**, healthcheck
   `/api/health`.
4. Segredos no GitHub: `DOKPLOY_WEBHOOK_URL`, `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`,
   `POSTGRES_CONTAINER`, `BACKUP_PASSPHRASE`.
5. Primeiro deploy → **Run Command** `pnpm db:seed` (uma vez).
6. Testar a restauração do backup.

### Checklist

- [ ] `https://<dominio>/api/health` → `{"status":"ok"}`
- [ ] login local entra; senha errada recusa; 5 falhas bloqueiam 15 min
- [ ] upload de imagem numa solicitação aparece no detalhe
- [ ] ninguém sem acesso baixa o anexo de outra demanda
- [ ] sem empresa/filial/catálogo de demonstração no banco
- [ ] `backup.yml` rodou e o artefato está cifrado
- [ ] restauração testada num banco descartável
- [ ] E2E local verde
