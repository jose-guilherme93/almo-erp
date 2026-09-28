import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACCESS_DENY_MESSAGES,
  type AccessDenyReason,
  isAccessDenyReason,
} from "@/lib/email-policy";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Acesso negado",
};

type AccessDeniedPageProps = {
  searchParams: Promise<{ motivo?: string }>;
};

/** O que o usuário deve fazer em cada situação. */
const NEXT_STEPS: Record<AccessDenyReason, string> = {
  "invalid-shape": "Saia e entre novamente com seu e-mail corporativo.",
  "domain-not-allowed":
    "Entre com sua conta corporativa. Contas pessoais não têm acesso ao sistema.",
  "pattern-mismatch":
    "Sua conta não atende à regra de acesso configurada. Peça ao administrador para revisar a política do seu domínio.",
  "awaiting-approval":
    "Um administrador precisa aprovar seu acesso. Você receberá uma notificação quando isso acontecer.",
  "pending-approval": "Peça a um administrador da sua unidade para aprovar seu acesso.",
  suspended: "Procure o administrador responsável para reativar seu acesso.",
  "user-inactive": "Procure o administrador responsável para reativar sua conta.",
  "access-denied": "Verifique se você usou a conta corporativa correta e tente novamente.",
};

async function getContactEmail(): Promise<string | null> {
  const config = await prisma.config.findUnique({
    where: { key: "email.contato" },
    select: { value: true },
  });

  const value = config?.value;

  return typeof value === "string" && value.includes("@") ? value : null;
}

export default async function AccessDeniedPage({ searchParams }: AccessDeniedPageProps) {
  const params = await searchParams;
  const rawReason = params.motivo ?? "access-denied";
  const reason: AccessDenyReason = isAccessDenyReason(rawReason) ? rawReason : "access-denied";

  const contactEmail = await getContactEmail();

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>
          <h1 className="text-xl font-semibold tracking-tight">Acesso não autorizado</h1>
        </CardTitle>
        <CardDescription className="text-balance">{ACCESS_DENY_MESSAGES[reason]}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="bg-muted/50 rounded-md px-3 py-2 text-sm">
          <p className="font-medium">O que fazer</p>
          <p className="text-muted-foreground mt-1">{NEXT_STEPS[reason]}</p>
        </div>

        {contactEmail ? (
          <p className="text-muted-foreground text-center text-sm">
            Precisa de ajuda? Fale com{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="text-foreground underline underline-offset-4"
            >
              {contactEmail}
            </a>
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Tentar outro e-mail</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
