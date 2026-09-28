"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { runAction, type ActionResult } from "@/lib/action-result";
import { ACTIVE_BRANCH_COOKIE } from "@/server/auth/context";
import { requireBranch } from "@/server/auth/guards";

/**
 * Troca a filial ativa do usuário.
 *
 * O `branchId` é **validado contra o escopo** antes de virar cookie: aceitar
 * um id arbitrário aqui seria uma porta para operar em outra unidade.
 */
export async function trocarFilialAtivaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ branchId: string }>> {
  return runAction(async () => {
    const branchId = formData.get("branchId");

    if (typeof branchId !== "string" || branchId.length === 0) {
      return { ok: false, error: "Unidade não informada." };
    }

    await requireBranch(branchId);

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_BRANCH_COOKIE, branchId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    revalidatePath("/", "layout");

    return { ok: true, data: { branchId }, message: "Unidade alterada." };
  });
}
