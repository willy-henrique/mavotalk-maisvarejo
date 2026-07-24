import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  assertBusinessPermission,
  permissionsForRole,
} from "../../lib/business-access/business-permissions";
import {
  hashBusinessPin,
  validatePinFormat,
} from "../../lib/business-access/business-pin-service";
import { nextPinFailureState } from "../../lib/business-access/business-pin-policy";
import { isBusinessSessionActive } from "../../lib/business-access/business-session-service";

test("matriz de papéis aplica permissões e overrides", () => {
  const owner = permissionsForRole("owner");
  assert.equal(owner.has("access.manage"), true);
  assert.equal(owner.has("finance.read"), true);

  const manager = permissionsForRole("manager");
  assert.equal(manager.has("sales.read"), true);
  assert.equal(manager.has("finance.read"), false);
  assert.throws(
    () => assertBusinessPermission(manager, "finance.read"),
    /não permitida/,
  );

  const custom = permissionsForRole("manager", {
    "finance.read": true,
    "inventory.read": false,
  });
  assert.equal(custom.has("finance.read"), true);
  assert.equal(custom.has("inventory.read"), false);
});

test("PIN exige 6 a 12 dígitos e nunca é armazenado em texto", async () => {
  assert.equal(validatePinFormat("123456"), true);
  assert.equal(validatePinFormat("12345"), false);
  assert.equal(validatePinFormat("12345a"), false);
  const hash = await hashBusinessPin("123456");
  assert.notEqual(hash, "123456");
  assert.equal(await bcrypt.compare("123456", hash), true);
  assert.equal(await bcrypt.compare("654321", hash), false);
});

test("quinta falha bloqueia e uma trava expirada abre nova janela", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  const fifth = nextPinFailureState({
    currentFailedAttempts: 4,
    currentLockedUntil: null,
    maxAttempts: 5,
    lockMinutes: 15,
    now,
  });
  assert.equal(fifth.failedAttempts, 5);
  assert.equal(fifth.lockedUntil?.toISOString(), "2026-07-23T12:15:00.000Z");

  const afterExpiry = nextPinFailureState({
    currentFailedAttempts: 5,
    currentLockedUntil: new Date("2026-07-23T11:59:00.000Z"),
    maxAttempts: 5,
    lockMinutes: 15,
    now,
  });
  assert.deepEqual(afterExpiry, { failedAttempts: 1, lockedUntil: null });
});

test("sessão expira e revogação tem efeito imediato", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  assert.equal(
    isBusinessSessionActive(
      { expiresAt: new Date("2026-07-23T12:01:00.000Z"), revokedAt: null },
      now,
    ),
    true,
  );
  assert.equal(
    isBusinessSessionActive(
      { expiresAt: new Date("2026-07-23T12:00:00.000Z"), revokedAt: null },
      now,
    ),
    false,
  );
  assert.equal(
    isBusinessSessionActive(
      {
        expiresAt: new Date("2026-07-23T12:01:00.000Z"),
        revokedAt: new Date("2026-07-23T11:59:00.000Z"),
      },
      now,
    ),
    false,
  );
});
