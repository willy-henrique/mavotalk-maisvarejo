import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabasePool, withTenantTransaction } from "../../lib/db";
import {
  createQueuePromotion,
  getActivePromotions,
  getPublishedQueueConfiguration,
  publishQueueAutomation,
  saveBusinessHourException,
  saveBusinessHours,
  saveBusinessLocation,
  saveQueueAutomationDraft,
} from "../../lib/queue-automation";
import {
  formatBusinessHoursResponse,
  formatPromotionResponse,
} from "../../lib/queue-automation-runtime";
import { expirePromotions } from "../../worker.mjs";

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const dryRunBaseUrl = String(process.env.QUEUE_AUTOMATION_DRY_RUN_BASE_URL || "").replace(/\/$/, "");

async function postDryRun(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${dryRunBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() as { reason?: string; replyDelivered?: boolean; replyText?: string | null } };
}

const offersConfig = (name: string) => ({
  queueType: "offers_promotions" as const,
  generalConfig: { name, description: null, menuOption: 1, defaultSlaMins: 5, colorHex: "#F97316", icon: null, isActive: true, allowReturnToMenu: true, createTicketOnHumanHandoff: true },
  automationConfig: { initialMessage: "Ofertas publicadas", noContentMessage: "Sem ofertas", closingMessage: null, allowHumanHandoff: true, showReturnToMenu: true, useAiFallback: false, enabled: true, beforeFlyerMessage: null, afterFlyerMessage: "Fim das ofertas", showValidity: true, maxFlyers: 5, deliveryMode: "all" as const, orderBy: "display_order" as const, returnToMenuAfterSend: false },
});

const hoursConfig = (name: string) => ({
  queueType: "business_hours_location" as const,
  generalConfig: { name, description: null, menuOption: 2, defaultSlaMins: 5, colorHex: "#2563EB", icon: null, isActive: true, allowReturnToMenu: true, createTicketOnHumanHandoff: true },
  automationConfig: { initialMessage: "Horários", noContentMessage: "Sem horário", closingMessage: null, allowHumanHandoff: true, showReturnToMenu: true, useAiFallback: false, enabled: true, openMessage: "Aberto até {closingTime}", closedMessage: "Fechado", intervalMessage: "Intervalo até {nextOpeningTime}", specialHoursMessage: "Especial {openingTime}-{closingTime}", showPhone: true, showAddress: true, showReferencePoint: true, showMapsUrl: true, showNextOpening: true },
});

test("integração PostgreSQL: publicação, runtime e isolamento das automações", { skip: !runDatabaseIntegration }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const organizationId = `qa_queue_${suffix}`;
  const otherOrganizationId = `qa_other_${suffix}`;
  const userId = `qa_user_${suffix}`;
  const offersQueueId = `qa_offers_${suffix}`;
  const hoursQueueId = `qa_hours_${suffix}`;

  try {
    await withTenantTransaction(organizationId, async (client) => {
      await client.query("INSERT INTO organizations (id,name) VALUES ($1,$2)", [organizationId, "QA queue automations"]);
      await client.query("INSERT INTO users (id,organization_id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5,'admin')", [userId, organizationId, "QA", `qa-${suffix}@example.test`, "not-used"]);
      await client.query("INSERT INTO queues (id,organization_id,name,menu_option,queue_type) VALUES ($1,$2,$3,1,'offers_promotions'),($4,$2,$5,2,'business_hours_location')", [offersQueueId, organizationId, "Ofertas", hoursQueueId, "Horários"]);
    });

    const now = new Date();
    await createQueuePromotion(organizationId, offersQueueId, userId, {
      title: "Oferta QA", description: "Descrição QA", caption: "Legenda QA", startsAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(), active: true, displayOrder: 0, handoffEnabled: true, afterSendMessage: null,
    }, { url: "https://example.test/flyer.png", publicId: `qa/${suffix}`, mimeType: "image/png", bytes: 32 });
    const expiredPromotion = await createQueuePromotion(organizationId, offersQueueId, userId, {
      title: "Oferta expirada QA", description: null, caption: null, startsAt: new Date(now.getTime() - 7_200_000).toISOString(), expiresAt: new Date(now.getTime() - 3_600_000).toISOString(), active: true, displayOrder: 1, handoffEnabled: true, afterSendMessage: null,
    }, { url: "https://example.test/expired.png", publicId: `qa/${suffix}-expired`, mimeType: "image/png", bytes: 32 });
    await saveQueueAutomationDraft(organizationId, offersQueueId, userId, offersConfig("Ofertas"));
    assert.deepEqual((await publishQueueAutomation(organizationId, offersQueueId, userId)).errors, {});
    const firstPublished = await getPublishedQueueConfiguration(organizationId, offersQueueId);
    assert.equal(firstPublished?.automationConfig.initialMessage, "Ofertas publicadas");
    const offerMessages = await formatPromotionResponse(organizationId, offersQueueId, now);
    assert.equal(offerMessages?.[0]?.text, "Ofertas publicadas");
    assert.equal(offerMessages?.some((message) => message.mediaUrl === "https://example.test/flyer.png"), true);
    assert.equal((await getActivePromotions(organizationId, offersQueueId, now)).length, 1);
    await expirePromotions();
    await withTenantTransaction(organizationId, async (client) => {
      const result = await client.query("SELECT status FROM promotions WHERE organization_id=$1 AND id=$2", [organizationId, String(expiredPromotion.id)]);
      assert.equal(result.rows[0]?.status, "expired");
    });
    await saveQueueAutomationDraft(organizationId, offersQueueId, userId, { ...offersConfig("Ofertas em rascunho"), automationConfig: { ...offersConfig("Ofertas").automationConfig, initialMessage: "Somente rascunho" } });
    assert.equal((await getPublishedQueueConfiguration(organizationId, offersQueueId))?.automationConfig.initialMessage, "Ofertas publicadas");
    await withTenantTransaction(otherOrganizationId, async (client) => {
      await client.query("INSERT INTO organizations (id,name) VALUES ($1,$2)", [otherOrganizationId, "QA outra organização"]);
    });
    assert.equal((await getActivePromotions(otherOrganizationId, offersQueueId, now)).length, 0);
    if (dryRunBaseUrl) {
      const offerDryRun = await postDryRun("/api/webhooks/n8n/ticket-upsert", { event_id: `qa-offers-${suffix}`, canal: "whatsapp", organization_id: organizationId, cliente: { nome: "Cliente QA", telefone: "62999990001" }, mensagem: "1" });
      assert.equal(offerDryRun.response.status, 200);
      assert.equal(offerDryRun.body.reason, "supermarket_self_service_1");
      assert.equal(offerDryRun.body.replyDelivered, true);
      assert.equal(offerDryRun.body.replyText, "Ofertas publicadas");
    }


    await saveBusinessLocation(organizationId, hoursQueueId, { unitName: "Unidade QA", displayName: null, address: "Avenida QA", number: "100", complement: null, district: "Centro", city: "Goiânia", state: "GO", postalCode: null, referencePoint: "Referência QA", phone: "(62) 0000-0000", whatsapp: null, mapsUrl: "https://maps.google.com/?q=qa", latitude: null, longitude: null, timezone: "America/Sao_Paulo" });
    await saveBusinessHours(organizationId, hoursQueueId, Array.from({ length: 7 }, (_, weekday) => ({ weekday, isOpen: weekday !== 2 && weekday !== 0, openingTime: weekday !== 2 && weekday !== 0 ? "08:00" : null, closingTime: weekday !== 2 && weekday !== 0 ? "12:00" : null, secondOpeningTime: weekday !== 2 && weekday !== 0 ? "14:00" : null, secondClosingTime: weekday !== 2 && weekday !== 0 ? "18:00" : null })));
    await saveBusinessHourException(organizationId, hoursQueueId, { date: "2026-08-04", title: "Feriado QA", isClosed: true, openingTime: null, closingTime: null });
    await saveQueueAutomationDraft(organizationId, hoursQueueId, userId, hoursConfig("Horários"));
    assert.deepEqual((await publishQueueAutomation(organizationId, hoursQueueId, userId)).errors, {});
    if (dryRunBaseUrl) {
      const hoursDryRun = await postDryRun("/api/webhooks/n8n/ticket-upsert", { event_id: `qa-hours-${suffix}`, canal: "whatsapp", organization_id: organizationId, cliente: { nome: "Cliente Horários", telefone: "62999990002" }, mensagem: "2" });
      assert.equal(hoursDryRun.response.status, 200);
      assert.equal(hoursDryRun.body.reason, "supermarket_self_service_2");
      assert.equal(hoursDryRun.body.replyDelivered, true);
      assert.match(hoursDryRun.body.replyText || "", /Avenida QA/);
    }
    const open = await formatBusinessHoursResponse(organizationId, hoursQueueId, new Date("2026-08-03T12:00:00.000Z"));
    assert.match(open?.[0]?.text || "", /Aberto até 12:00/);
    assert.match(open?.[0]?.text || "", /Avenida QA/);
    const interval = await formatBusinessHoursResponse(organizationId, hoursQueueId, new Date("2026-08-03T16:00:00.000Z"));
    assert.match(interval?.[0]?.text || "", /Intervalo até 14:00/);
    const nextOpening = await formatBusinessHoursResponse(organizationId, hoursQueueId, new Date("2026-08-03T22:00:00.000Z"));
    assert.match(nextOpening?.[0]?.text || "", /Próxima abertura: em 05\/08\/2026, às 08:00/);
  } finally {
    await withTenantTransaction(organizationId, async (client) => {
      await client.query("DELETE FROM messages WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM tickets WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM conversations WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM contacts WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM queue_configuration_history WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM queue_configurations WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM promotion_media WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM promotions WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM business_special_hours WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM business_hours WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM business_locations WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM queues WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM users WHERE organization_id=$1", [organizationId]);
      await client.query("DELETE FROM organizations WHERE id=$1", [organizationId]);
    }).catch(() => undefined);
    await withTenantTransaction(otherOrganizationId, async (client) => {
      await client.query("DELETE FROM organizations WHERE id=$1", [otherOrganizationId]);
    }).catch(() => undefined);
    await closeDatabasePool();
  }
});
