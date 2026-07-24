import { createAuditLog, createQueue, listQueues, updateQueue } from "@/lib/repo";
import { SUPERMARKET_QUEUE_PRESET } from "@/lib/supermarket-config";

type QueueLike = {
  id: string;
  menuOption: number;
  name: string;
  colorHex: string;
  defaultSlaMins: number;
  isActive: boolean;
};

export type SupermarketPresetResult = {
  queues: Awaited<ReturnType<typeof listQueues>>;
  created: number;
  updated: number;
  paused: number;
};

export function isSupermarketQueuePresetApplied(queues: QueueLike[]): boolean {
  const presetOptions = new Set(SUPERMARKET_QUEUE_PRESET.map((item) => item.menuOption));
  const presetMatches = SUPERMARKET_QUEUE_PRESET.every((preset) => {
    const queue = queues.find((item) => Number(item.menuOption) === preset.menuOption);
    return Boolean(
      queue &&
        queue.isActive !== false &&
        queue.name === preset.name &&
        queue.colorHex.toUpperCase() === preset.colorHex.toUpperCase() &&
        Number(queue.defaultSlaMins) === preset.defaultSlaMins,
    );
  });
  const noUnexpectedActiveQueue = queues.every(
    (queue) => queue.isActive === false || presetOptions.has(Number(queue.menuOption)),
  );
  return presetMatches && noUnexpectedActiveQueue;
}

export async function applySupermarketQueuePreset(
  organizationId: string,
  actorUserId: string | null,
): Promise<SupermarketPresetResult> {
  const existing = await listQueues(organizationId);
  let created = 0;
  let updated = 0;
  let paused = 0;

  for (const preset of SUPERMARKET_QUEUE_PRESET) {
    const current = existing.find((queue) => Number(queue.menuOption) === preset.menuOption);
    const payload = {
      name: preset.name,
      menuOption: preset.menuOption,
      colorHex: preset.colorHex,
      defaultSlaMins: preset.defaultSlaMins,
      isActive: true,
    };

    if (current) {
      const changed =
        current.name !== preset.name ||
        current.colorHex.toUpperCase() !== preset.colorHex.toUpperCase() ||
        Number(current.defaultSlaMins) !== preset.defaultSlaMins ||
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

  const presetOptions = new Set(SUPERMARKET_QUEUE_PRESET.map((item) => item.menuOption));
  for (const queue of existing) {
    if (!presetOptions.has(Number(queue.menuOption)) && queue.isActive !== false) {
      await updateQueue(organizationId, String(queue.id), { isActive: false });
      paused += 1;
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
