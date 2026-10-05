import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

/**
 * Healthcheck da aplicação.
 *
 * Serve para o `healthcheck` do container e para monitor de uptime. Não expõe
 * dado de negócio: só confirma que o processo responde e que o banco aceita
 * uma consulta trivial. Fica fora do gate do `proxy.ts` (matcher), senão o
 * middleware redirecionaria para `/login` e o check nunca veria 200.
 */
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3_000;

async function checkDatabase(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("database healthcheck timeout")), TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  try {
    await checkDatabase();

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
