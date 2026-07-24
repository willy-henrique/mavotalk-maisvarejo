import test from "node:test";
import assert from "node:assert/strict";
import {
  getDefaultBusinessSchedule,
  resolveBusinessSchedule,
} from "../../lib/business-hours";

test("usa o expediente padrão do supermercado quando o banco não está configurado", () => {
  assert.deepEqual(getDefaultBusinessSchedule(1, {}), {
    startTime: "07:00",
    endTime: "21:00",
  });
  assert.deepEqual(getDefaultBusinessSchedule(0, {}), {
    startTime: "08:00",
    endTime: "14:00",
  });
});

test("permite configurar sábado e domingo por ambiente", () => {
  const environment = {
    BUSINESS_HOURS_SATURDAY_START: "08:30",
    BUSINESS_HOURS_SATURDAY_END: "19:15",
    BUSINESS_HOURS_SUNDAY_CLOSED: "true",
  };

  assert.deepEqual(getDefaultBusinessSchedule(6, environment), {
    startTime: "08:30",
    endTime: "19:15",
  });
  assert.equal(getDefaultBusinessSchedule(0, environment), null);
});

test("ignora horários inválidos e mantém defaults seguros", () => {
  assert.deepEqual(
    getDefaultBusinessSchedule(2, {
      BUSINESS_HOURS_WEEKDAY_START: "25:99",
      BUSINESS_HOURS_WEEKDAY_END: "qualquer",
    }),
    {
      startTime: "07:00",
      endTime: "21:00",
    },
  );
});

test("dia desativado no banco permanece fechado e não cai no fallback", () => {
  assert.equal(
    resolveBusinessSchedule(
      0,
      {
        startTime: "08:00",
        endTime: "14:00",
        isActive: false,
      },
      {},
    ),
    null,
  );
});

test("cadastro ativo do banco tem prioridade sobre as variáveis", () => {
  assert.deepEqual(
    resolveBusinessSchedule(
      1,
      {
        startTime: "09:00",
        endTime: "18:00",
        isActive: true,
      },
      {
        BUSINESS_HOURS_WEEKDAY_START: "07:00",
        BUSINESS_HOURS_WEEKDAY_END: "21:00",
      },
    ),
    {
      startTime: "09:00",
      endTime: "18:00",
    },
  );
});
