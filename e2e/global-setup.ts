import { chromium } from "@playwright/test";

import { loginAs } from "./helpers/auth";
import { APP_ROUTES } from "./helpers/routes";

/**
 * Compila as telas antes do primeiro teste.
 *
 * `next dev` compila cada rota **na primeira visita**. Sem este passo, a
 * compilação acontece dentro do teste, disputa o `expect.timeout` de 15s, e o que
 * se vê é falha por lentidão que não é defeito de ninguém — que o `retries: 1` do
 * CI então repete, dobrando o custo.
 *
 * Medido: foi assim que a suíte passou de 25 minutos no runner sem fechar os 93
 * cenários.
 *
 * ## Por que um login só basta
 *
 * A compilação é por **rota**, não por permissão: basta um usuário que passe pelo
 * gate de sessão. As telas que aquele perfil não pode ver redirecionam, mas o
 * módulo da rota já foi compilado nesse momento — que é o que se quer aqui.
 *
 * ## Por que a falha de uma rota não derruba o warm-up
 *
 * O objetivo é **aquecer**, não verificar. Uma rota que erra (id de unidade
 * inexistente, por exemplo) já cumpriu o papel: compilou. Deixar o warm-up falhar
 * por isso trocaria um problema de lentidão por um erro de setup, que é pior.
 */
export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await loginAs(page, "superAdmin");

    for (const route of APP_ROUTES) {
      try {
        // `domcontentloaded` e não `networkidle`: o que importa é a resposta ter
        // chegado, e `networkidle` esperaria o dev server ficar ocioso — que é
        // justamente o que ele não fica durante a compilação.
        await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      } catch {
        // Rota aquecida mesmo assim: segue para a próxima.
      }
    }
  } finally {
    await browser.close();
  }
}
