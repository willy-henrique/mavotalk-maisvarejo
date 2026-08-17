import test from "node:test";
import assert from "node:assert/strict";
import {
  syncWhatsappContactAvatars,
  type WhatsappAvatarUpdate,
} from "../../lib/whatsapp-contact-avatars";

test("sincroniza fotos disponíveis sem falhar por privacidade de outro contato", async () => {
  let persisted: WhatsappAvatarUpdate[] = [];
  const result = await syncWhatsappContactAvatars({
    targets: [
      { phoneNumber: "whatsapp:+551100000001", jid: "551100000001@s.whatsapp.net" },
      { phoneNumber: "whatsapp:+551100000001", jid: "duplicado@s.whatsapp.net" },
      { phoneNumber: "whatsapp:+551100000002", jid: "551100000002@s.whatsapp.net" },
      { phoneNumber: "whatsapp:+551100000003", jid: "551100000003@s.whatsapp.net" },
    ],
    profilePictureUrl: async (jid) => {
      if (jid.startsWith("551100000001")) return "https://pps.whatsapp.net/avatar-1.jpg";
      if (jid.startsWith("551100000002")) throw new Error("not-authorized");
      return "http://inseguro.example/avatar.jpg";
    },
    persist: async (updates) => {
      persisted = updates;
      return updates.length;
    },
  });

  assert.deepEqual(result, { requested: 3, found: 1, saved: 1, unavailable: 2 });
  assert.deepEqual(persisted, [{
    phoneNumber: "whatsapp:+551100000001",
    avatarUrl: "https://pps.whatsapp.net/avatar-1.jpg",
  }]);
});

test("limita consultas paralelas de foto para proteger a sessão do WhatsApp", async () => {
  let active = 0;
  let maximumActive = 0;
  const targets = Array.from({ length: 8 }, (_, index) => ({
    phoneNumber: `whatsapp:+5511000000${index}`,
    jid: `5511000000${index}@s.whatsapp.net`,
  }));

  const result = await syncWhatsappContactAvatars({
    targets,
    concurrency: 2,
    profilePictureUrl: async (jid) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return `https://pps.whatsapp.net/${jid}.jpg`;
    },
    persist: async (updates) => updates.length,
  });

  assert.equal(maximumActive, 2);
  assert.equal(result.requested, 8);
  assert.equal(result.saved, 8);
});

test("não acessa o banco quando não há contato utilizável", async () => {
  let persisted = false;
  const result = await syncWhatsappContactAvatars({
    targets: [],
    profilePictureUrl: async () => null,
    persist: async () => {
      persisted = true;
      return 0;
    },
  });

  assert.deepEqual(result, { requested: 0, found: 0, saved: 0, unavailable: 0 });
  assert.equal(persisted, false);
});
