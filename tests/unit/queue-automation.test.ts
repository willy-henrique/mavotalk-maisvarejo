import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { businessHoursSchema, promotionInputSchema, queueConfigurationInputSchema } from "../../lib/queue-automation-schemas";
import { validatePromotionImage } from "../../lib/image-upload-validation";

const offersConfig = {
  queueType: "offers_promotions",
  generalConfig: { name: "Ofertas", description: null, menuOption: 1, defaultSlaMins: 5, colorHex: "#F97316", icon: null, isActive: true, allowReturnToMenu: true, createTicketOnHumanHandoff: true },
  automationConfig: { initialMessage: "Confira", noContentMessage: "Sem ofertas", closingMessage: null, allowHumanHandoff: true, showReturnToMenu: true, useAiFallback: false, enabled: true, beforeFlyerMessage: null, afterFlyerMessage: null, showValidity: true, maxFlyers: 5, deliveryMode: "all", orderBy: "display_order", returnToMenuAfterSend: false },
};

test("schemas de automação recusam campos arbitrários e datas invertidas", () => {
  assert.equal(queueConfigurationInputSchema.safeParse(offersConfig).success, true);
  assert.equal(queueConfigurationInputSchema.safeParse({ ...offersConfig, unknown: true }).success, false);
  assert.equal(promotionInputSchema.safeParse({ title: "Oferta", startsAt: "2026-07-31T12:00:00.000Z", expiresAt: "2026-07-31T11:00:00.000Z" }).success, false);
});

test("horários aceitam dois períodos válidos e recusam intervalo sobreposto", () => {
  const base = Array.from({ length: 7 }, (_, weekday) => ({ weekday, isOpen: weekday === 1, openingTime: weekday === 1 ? "08:00" : null, closingTime: weekday === 1 ? "12:00" : null, secondOpeningTime: weekday === 1 ? "14:00" : null, secondClosingTime: weekday === 1 ? "18:00" : null }));
  assert.equal(businessHoursSchema.safeParse(base).success, true);
  base[1].secondOpeningTime = "11:00";
  assert.equal(businessHoursSchema.safeParse(base).success, false);
});

test("validação de flyer confere assinatura do arquivo, não apenas MIME informado", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(validatePromotionImage({ size: png.length, type: "text/plain" } as File, png).mimeType, "image/png");
  assert.throws(() => validatePromotionImage({ size: 4, type: "image/png" } as File, new Uint8Array([1, 2, 3, 4])));
});

test("migration e bot usam configuração publicada e isolamento por tenant", async () => {
  const [migration, service, route] = await Promise.all([
    readFile("supabase/migrations/202607310012_queue_automations.sql", "utf8"),
    readFile("lib/queue-automation.ts", "utf8"),
    readFile("app/api/webhooks/n8n/ticket-upsert/route.ts", "utf8"),
  ]);
  assert.match(migration, /queue_configurations/);
  assert.match(migration, /queue_configuration_history/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(service, /p\.organization_id=\$1 AND p\.queue_id=\$2 AND p\.published_at IS NOT NULL AND p\.published_active=true AND p\.published_archived=false AND p\.starts_at <= \$3 AND p\.expires_at > \$3/);
  assert.match(route, /formatPromotionResponse/);
  assert.match(route, /formatBusinessHoursResponse/);
});
