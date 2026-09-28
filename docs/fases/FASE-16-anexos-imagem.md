# FASE 16 — Anexos de imagem com compressão

> Foto do problema no chamado, sem estourar o banco nem o tempo de upload.

## Contexto

Quem abre um reparo no balcão tira uma foto do equipamento. Enviar a foto
original do celular (5–10 MB) é ruim para o usuário e para o servidor. A
compressão acontece **no navegador**, antes do envio.

## Pré-requisitos

- FASE 14 concluída.

## Tarefas

- [x] Compressão no cliente (`src/lib/image-compression.ts`): redimensiona para
      no máximo 1600px no maior lado, reencoda em WebP com qualidade 0.8 e só
      usa o resultado se ficar menor que o original.
- [x] Componente `ImageInput` (câmera/galeria, pré-visualização, limite de 5).
- [x] Modelo `Attachment` (metadados) com `storageKey` em disco.
- [x] Gravação em arquivo em `UPLOAD_DIR` (padrão `./var/uploads`, ignorado pelo git).
- [x] Anexos criados na mesma transação da solicitação/chamado.
- [x] Route handler `/api/anexos/[id]` com a **mesma visibilidade** da entidade
      pai (ninguém baixa a imagem de um pedido que não enxerga).
- [x] `serverActions.bodySizeLimit` ajustado no `next.config.ts`.
- [x] Galeria no detalhe da solicitação e do chamado.
- [x] Limpeza de arquivo órfão quando a transação falha.

## Pendências conhecidas

- [ ] Envio de foto avulsa direto no detalhe (a ação `anexarImagemAction` já
      existe; falta o componente na tela de detalhe).
- [ ] Volume persistente/compartilhado em produção (hoje o default é disco local;
      para múltiplas instâncias, apontar `UPLOAD_DIR` para um volume compartilhado).
- [ ] Leitura de dimensões/EXIF no servidor para validação adicional.

## Critérios de aceite

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdes.
- [x] Uma foto de celular chega ao servidor bem abaixo do limite de upload.
- [x] Um usuário sem acesso à demanda não consegue baixar o anexo.
