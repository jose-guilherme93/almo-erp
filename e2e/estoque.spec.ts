import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";
import { idFromUrl, lancarEntrada, openAs, pickItem } from "./helpers/flows";

/**
 * Estoque e transferências (FASES 06 e 07).
 *
 * Cobre o ledger visto pelo usuário: entrada gera saldo, ajuste exige
 * justificativa e a transferência baixa na origem e credita no destino.
 */

test.describe.configure({ timeout: 120_000 });

/**
 * Código de barras válido e diferente a cada execução.
 *
 * O teste cria um material de verdade no banco, então um código fixo faria a
 * segunda rodada não encontrar nada a cadastrar. Prefixo 200, reservado para uso
 * interno, e o dígito verificador calculado aqui.
 */
function newUnknownBarcode(): string {
  const body = `200${Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, "0")}`;

  const sum = body
    .split("")
    .map(Number)
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);

  return `${body}${(10 - (sum % 10)) % 10}`;
}

test.describe("estoque", () => {
  test("entrada gera saldo e documento lançado", async ({ page }) => {
    await loginAs(page, "almoxarife");
    await lancarEntrada(page, "EPI-0001", "25");

    // O documento fica imutável assim que é lançado.
    await expect(page.getByText("Lançado", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Capacete de segurança classe B").first()).toBeVisible();

    await page.goto("/estoque/saldos");
    await expect(page.getByText("Capacete de segurança classe B").first()).toBeVisible();
  });

  test("ajuste exige justificativa antes de mexer no saldo", async ({ page }) => {
    await loginAs(page, "almoxarife");

    // Garante que existe saldo para o ajuste reduzir.
    await lancarEntrada(page, "LMP-0002", "10");

    await page.goto("/estoque/ajustes/novo");
    await pickItem(page, "LMP-0002");
    await page.getByLabel(/Quantidade \(/).fill("-1");
    await page.getByRole("button", { name: "Lançar ajuste" }).click();

    await expect(page.getByText(/A justificativa do ajuste é obrigatória/).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel(/Justificativa/).fill("Quebra identificada na contagem física");
    await page.getByRole("button", { name: "Lançar ajuste" }).click();

    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/[^/]+/, { timeout: 20_000 });
    await expect(page.getByText("Ajuste", { exact: true }).first()).toBeVisible();
  });
});

/**
 * Caminho da doca (FASE 19).
 *
 * O cenário que matava o fluxo em produção: um código de barras que ainda não
 * pertence a nenhum material não pode obrigar o usuário a sair da entrada para
 * cadastrar o material antes.
 *
 * O teste digita o código em vez de usar a câmera — é o mesmo caminho do
 * `ItemCombobox` (mesma action, mesmo formulário), e é o que roda em CI.
 */
test.describe("cadastro pela doca", () => {
  test("código de barras desconhecido cria o material e lança a entrada", async ({ page }) => {
    await loginAs(page, "almoxarife");

    await page.goto("/estoque/entradas/nova");

    const barcode = newUnknownBarcode();
    const nome = `Luva de Raspa E2E ${barcode.slice(-4)}`;

    const search = page.getByLabel(/Buscar material por nome, código ou código de barras/).first();
    await search.fill(barcode);

    // Sem material correspondente, o caminho continua aqui em vez de terminar.
    const createButton = page.getByRole("button", {
      name: new RegExp(`Cadastrar material com o código ${barcode}`),
    });

    await expect(createButton).toBeVisible({ timeout: 20_000 });
    await createButton.click();

    await page.getByLabel("Nome do material").fill(nome);
    await page.getByRole("button", { name: "Cadastrar e adicionar" }).click();

    // A linha entrou no documento: só falta a quantidade e lançar.
    await expect(page.getByText(nome)).toBeVisible({ timeout: 20_000 });
    // SKU gerado pelo servidor a partir da categoria "Geral".
    await expect(page.getByText(/GERAL-\d+/).first()).toBeVisible();

    await page.getByLabel(/Quantidade \(/).fill("7");
    await page.getByRole("button", { name: "Lançar entrada" }).click();

    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/[^/]+/, { timeout: 20_000 });
    await expect(page.getByText(nome).first()).toBeVisible();

    // E o material ficou no catálogo, pronto para a próxima leitura.
    await page.goto(`/catalogo/itens?busca=${encodeURIComponent(nome)}`);
    await expect(page.getByText(nome).first()).toBeVisible();
  });

  /**
   * Regressão do botão "Usar câmera".
   *
   * O leitor lia a ref do `<video>` antes de o elemento existir, então o primeiro
   * clique morria em silêncio: `getUserMedia` nunca era chamado e nenhum vídeo
   * aparecia. O teste exige o stream real chegando ao elemento, com a permissão
   * concedida e a câmera sintética do Chromium ligada.
   */
  test("a câmera do leitor sobe e mostra o vídeo", async ({ page }) => {
    await loginAs(page, "almoxarife");
    await page.goto("/estoque/entradas/nova");

    await page.getByRole("button", { name: "Ler código de barras" }).click();
    await page.getByRole("button", { name: "Usar câmera" }).click();

    // Elemento montado e recebendo frames — não basta existir.
    await page.waitForFunction(
      () => {
        const video = document.querySelector("video");
        return video instanceof HTMLVideoElement && video.videoWidth > 0 && video.readyState >= 2;
      },
      { timeout: 20_000 },
    );

    const stream = await page.locator("video").evaluate((element) => {
      const video = element as HTMLVideoElement;
      const media = video.srcObject as MediaStream | null;
      const track = media?.getVideoTracks()[0] ?? null;

      return { track: track?.kind ?? null, state: track?.readyState ?? null };
    });

    expect(stream).toEqual({ track: "video", state: "live" });

    // Parar precisa desligar o stream (a luz da câmera não pode ficar acesa).
    await page.getByRole("button", { name: "Parar câmera" }).click();
    await expect(page.locator("video")).toHaveCount(0);
  });

  test("solicitante não cadastra material pela doca", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/estoque/entradas/nova");

    // Sem `estoque:entrada` a tela nem existe para ele.
    await expect(page).toHaveURL(/\/forbidden|\/not-found/);
  });
});

test.describe("transferências", () => {
  test("envia da origem e recebe no destino", async ({ browser }) => {
    const almoxarife = await openAs(browser, "almoxarife");
    await lancarEntrada(almoxarife, "LMP-0001", "30");

    await almoxarife.goto("/transferencias/nova");
    await almoxarife.locator("#destination").click();
    await almoxarife
      .getByRole("option", { name: /FIL-RJ/ })
      .first()
      .click();
    await pickItem(almoxarife, "LMP-0001");
    await almoxarife.getByLabel(/Quantidade \(/).fill("5");
    await almoxarife.getByRole("button", { name: "Criar transferência" }).click();

    await expect(almoxarife).toHaveURL(/\/transferencias\/[^/?]+\?criada=1/, { timeout: 20_000 });
    const transferId = idFromUrl(almoxarife.url(), "transferencias");

    // Enviar baixa o saldo da origem.
    await almoxarife.getByRole("button", { name: "Enviar (baixa na origem)" }).click();
    await expect(almoxarife.getByText("Enviada", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    // A matriz responde pelo destino (nenhum usuário de demonstração está no RJ).
    const matriz = await openAs(browser, "superAdmin");
    await matriz.goto(`/transferencias/${transferId}`);
    await matriz.getByRole("button", { name: "Receber material" }).click();
    await matriz.getByRole("button", { name: "Confirmar recebimento" }).click();

    await expect(matriz.getByText("Recebida", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
