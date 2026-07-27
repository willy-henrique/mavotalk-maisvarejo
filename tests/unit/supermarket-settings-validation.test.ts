import test from "node:test";
import assert from "node:assert/strict";
import { parseBusinessHoursPatch, parseSupermarketSettingsPatch } from "../../lib/supermarket-settings-validation";

test("configuração pública exige identidade e aceita limpar campos opcionais", () => {
  const parsed = parseSupermarketSettingsPatch({
    botName: "  Mavo  ",
    storeName: "  Supermercado Central  ",
    address: "",
    phone: null,
  });

  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.data, {
    botName: "Mavo",
    storeName: "Supermercado Central",
    address: null,
    phone: null,
  });
});

test("configuração pública recusa identidade vazia e links não HTTP", () => {
  assert.match(parseSupermarketSettingsPatch({ botName: "   " }).error || "", /obrigatório/);
  assert.match(parseSupermarketSettingsPatch({ storeName: "" }).error || "", /obrigatório/);
  assert.match(parseSupermarketSettingsPatch({ offersUrl: "javascript:alert(1)" }).error || "", /http ou https/);
  assert.match(parseSupermarketSettingsPatch({ mapsUrl: "not-a-url" }).error || "", /inválido/);
  assert.equal(parseSupermarketSettingsPatch({ offersUrl: "https://example.test/ofertas" }).data.offersUrl, "https://example.test/ofertas");
});

test("horários recusam dias duplicados, fuso enganoso e intervalos invertidos", () => {
  assert.match(parseBusinessHoursPatch([{ weekday: 1, startTime: "21:00", endTime: "07:00", isActive: true }]).error || "", /abertura/);
  assert.match(parseBusinessHoursPatch([{ weekday: 1, startTime: "07:00", endTime: "21:00" }, { weekday: 1, startTime: "07:00", endTime: "21:00" }]).error || "", /única vez/);
  assert.match(parseBusinessHoursPatch([{ weekday: 1, startTime: "07:00", endTime: "21:00", timezone: "UTC" }]).error || "", /America\/Sao_Paulo/);
  assert.deepEqual(parseBusinessHoursPatch([{ weekday: 1, startTime: "07:00", endTime: "21:00", isActive: true }]).data, [{ weekday: 1, startTime: "07:00", endTime: "21:00", timezone: "America/Sao_Paulo", isActive: true }]);
});
