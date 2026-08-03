import { createAuditLog, createQueue, listQueues, updateQueue } from "@/lib/repo";
import { queueTypeForMenuOption, SUPERMARKET_QUEUE_PRESET } from "@/lib/supermarket-config";

export type SupermarketPresetResult = {
  queues: Awaited<ReturnType<typeof listQueues>>;
  created: number;
  updated: number;
  paused: number;
};

export async function applySupermarketQueuePreset(
  organizationId: string,
  actorUserId: string | null,
): Promise<SupermarketPresetResult> {
  const existing = await listQueues(organizationId);
  let created = 0;
  let updated = 0;
  const paused = 0;

  for (const preset of SUPERMARKET_QUEUE_PRESET) {
    const current = existing.find((queue) => Number(queue.menuOption) === preset.menuOption);
    const payload = {
      // O preset cria a estrutura inicial; depois disso o administrador pode
      // personalizar nome, cor e SLA sem ser sobrescrito por cada mensagem.
      name: current?.name || preset.name,
      menuOption: preset.menuOption,
      colorHex: current?.colorHex || preset.colorHex,
      defaultSlaMins: current?.defaultSlaMins || preset.defaultSlaMins,
      isActive: true,
      queueType: queueTypeForMenuOption(preset.menuOption),
    };

    if (current) {
      const changed =
        current.isActive === false;
      if (changed) {
        await updateQueue(organizationId, String(current.id), payload);
        updated += 1;
      }
    } else {
      await createQueue(organizationId, payload);
      created += 1;
    }
  }

  await createAuditLog(
    organizationId,
    actorUserId,
    "apply_supermarket_queue_preset",
    "organization",
    organizationId,
    { created, updated, paused, options: SUPERMARKET_QUEUE_PRESET.length },
  );

  return {
    queues: await listQueues(organizationId),
    created,
    updated,
    paused,
  };
}
