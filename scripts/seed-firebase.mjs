import "dotenv/config";
import bcrypt from "bcryptjs";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function normalizePrivateKey(raw) {
  if (!raw) return "";
  return raw.replace(/\\n/g, "\n").replace(/\\\r?\n/g, "\n").trim();
}

function initFirebase() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    initializeApp({
      credential: cert(parsed),
      projectId: parsed.project_id,
    });
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    try {
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
        projectId,
      });
      return;
    } catch {
      // fallback para arquivo
    }
  }

  const keyFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || "willtalk-40733-firebase-adminsdk-fbsvc-1b7ffd8fe3.json";
  try {
    const raw = readFileSync(resolve(process.cwd(), keyFile), "utf8");
    const parsed = JSON.parse(raw);
    initializeApp({
      credential: cert(parsed),
      projectId: parsed.project_id,
    });
    return;
  } catch {
    throw new Error("Firebase nao configurado para seed");
  }
}

async function main() {
  initFirebase();
  const db = getFirestore();

  const orgId = process.env.DEFAULT_ORG_ID || "org_willtalk_default";
  const orgRef = db.collection("organizations").doc(orgId);
  await orgRef.set(
    {
      name: "WillTalk Suporte",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@willtalk.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const existingUser = await db.collection("users").where("email", "==", adminEmail).limit(1).get();
  if (existingUser.empty) {
    await db.collection("users").add({
      organizationId: orgId,
      name: "Administrador",
      email: adminEmail,
      passwordHash,
      role: "admin",
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await existingUser.docs[0].ref.update({
      organizationId: orgId,
      role: "admin",
      passwordHash,
      isActive: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+5511999999999";
  const channelDoc = await db.collection("channels").where("twilioPhoneNumber", "==", twilioNumber).limit(1).get();
  if (channelDoc.empty) {
    await db.collection("channels").add({
      organizationId: orgId,
      provider: "twilio",
      twilioPhoneNumber: twilioNumber,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const demands = [
    { menuOption: 1, name: "SPED (FISCAL)", colorHex: "#0EA5E9", defaultSlaMins: 30 },
    { menuOption: 2, name: "Notas Saidas", colorHex: "#10B981", defaultSlaMins: 30 },
    { menuOption: 3, name: "Notas Entrada", colorHex: "#F59E0B", defaultSlaMins: 30 },
    { menuOption: 4, name: "Balanca", colorHex: "#EF4444", defaultSlaMins: 45 },
    { menuOption: 5, name: "Impressora", colorHex: "#8B5CF6", defaultSlaMins: 45 },
  ];

  for (const demand of demands) {
    const q = await db
      .collection("queues")
      .where("organizationId", "==", orgId)
      .where("menuOption", "==", demand.menuOption)
      .limit(1)
      .get();

    if (q.empty) {
      await db.collection("queues").add({
        organizationId: orgId,
        ...demand,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await q.docs[0].ref.update({
        ...demand,
        isActive: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  const businessDefaults = [
    { weekday: 1, startTime: "08:00", endTime: "18:00" },
    { weekday: 2, startTime: "08:00", endTime: "18:00" },
    { weekday: 3, startTime: "08:00", endTime: "18:00" },
    { weekday: 4, startTime: "08:00", endTime: "18:00" },
    { weekday: 5, startTime: "08:00", endTime: "18:00" },
  ];

  for (const bh of businessDefaults) {
    const b = await db
      .collection("business_hours")
      .where("organizationId", "==", orgId)
      .where("weekday", "==", bh.weekday)
      .limit(1)
      .get();

    if (b.empty) {
      await db.collection("business_hours").add({
        organizationId: orgId,
        ...bh,
        timezone: "America/Sao_Paulo",
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await b.docs[0].ref.update({
        ...bh,
        isActive: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log("Seed Firebase concluido");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
