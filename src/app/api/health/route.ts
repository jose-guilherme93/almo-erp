import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { APP_VERSION, BUILD_TIME, GIT_SHA } from "@/lib/version";

/**
 * Healthcheck da aplicação.
 *
 * Serve para o `healthcheck` do container e para monitor de uptime. Não expõe
 * dado de negócio: só confirma que o processo responde e que o banco aceita
 * uma consulta trivial. Fica fora do gate do `proxy.ts` (matcher), senão o
 * middleware redirecionaria para `/login` e o check nunca veria 200.
 * Também informa a versão em execução (semver + commit + data do build).
 */
export const dynamic = "force-dynamic";

function versionInfo() {
  return { version: APP_VERSION, commit: GIT_SHA, builtAt: BUILD_TIME };
}

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

    return NextResponse.json({ status: "ok", ...versionInfo() }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "unavailable", ...versionInfo() }, { status: 503 });
  }
}
