import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function normalizePrivateKey(raw?: string) {
  if (!raw) return "";
  return raw.replace(/\\n/g, "\n").replace(/\\\r?\n/g, "\n").trim();
}

function getFirebaseApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    return initializeApp({
      credential: cert(parsed),
      projectId: parsed.project_id,
    });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    return initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || "willtalk-local",
    });
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
  });
}

const app = getFirebaseApp();
export const db = getFirestore(app);
