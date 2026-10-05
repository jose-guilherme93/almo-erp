"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { requireSession } from "@/server/auth/guards";
import { formDataToValues, readFiles, readText, validationFailure } from "@/server/actions/helpers";
import { createAttachmentRows, storeUploadedImages } from "@/server/services/attachment";
import { getMaintenanceRequest } from "@/server/services/maintenance";
import { getRequestDetail } from "@/server/services/request";
import { z } from "zod";

/** Anexar imagens a uma solicitação ou chamado já existente. */

const schema = z.object({
  entityType: z.enum(["REQUEST", "MAINTENANCE"]),
  entityId: z.string().trim().min(1),
});

export async function anexarImagemAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const context = await requireSession();
    const values = formDataToValues(formData);

    const parsed = schema.safeParse({
      entityType: readText(values, "entityType"),
      entityId: readText(values, "entityId"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const files = readFiles(formData, "fotos");
    const stored = await storeUploadedImages(files);

    if (stored.length === 0) {
      throw new BusinessRuleError("Selecione ao menos uma imagem.");
    }

    if (parsed.data.entityType === "REQUEST") {
      const request = await getRequestDetail(context, parsed.data.entityId);
      const allowed =
        request.requester.id === context.user.id ||
        context.hasPermission("solicitacao:overview", request.branch.id) ||
        context.hasPermission("solicitacao:entregar", request.branch.id);

      if (!allowed) throw new BusinessRuleError("Você não pode anexar imagens a esta solicitação.");

      await createAttachmentRows(prisma, {
        attachments: stored,
        uploadedById: context.user.id,
        requestId: parsed.data.entityId,
      });

      revalidatePath(`/solicitacoes/${parsed.data.entityId}`);
    } else {
      const maintenance = await getMaintenanceRequest(context, parsed.data.entityId);
      const allowed =
        maintenance.requester.id === context.user.id ||
        context.hasPermission("manutencao:overview", maintenance.branch.id) ||
        context.hasPermission("manutencao:atender", maintenance.branch.id);

      if (!allowed) throw new BusinessRuleError("Você não pode anexar imagens a este chamado.");

      await createAttachmentRows(prisma, {
        attachments: stored,
        uploadedById: context.user.id,
        maintenanceRequestId: parsed.data.entityId,
      });

      revalidatePath(`/reparos/${parsed.data.entityId}`);
    }

    return actionSuccess(
      { count: stored.length },
      stored.length === 1 ? "Imagem anexada." : `${stored.length} imagens anexadas.`,
    );
  });
}
