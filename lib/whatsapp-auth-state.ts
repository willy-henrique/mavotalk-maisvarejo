import { rm } from "node:fs/promises";
import path from "node:path";
import {
  initAuthCreds,
  proto,
  useMultiFileAuthState as createMultiFileAuthState,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import type { PoolClient } from "pg";
import { withTenantTransaction } from "@/lib/db";
import {
  decryptWhatsappAuthValue,
  encryptWhatsappAuthValue,
  type EncryptedWhatsappAuthValue,
} from "@/lib/whatsapp-auth-crypto";
import {
  configuredWhatsappAuthKeyMaterials,
  configuredWhatsappAuthPersistence,
  configuredWhatsappAuthStore,
  type WhatsappAuthStore,
} from "@/lib/whatsapp-auth-config";

export type { WhatsappAuthStore } from "@/lib/whatsapp-auth-config";

export type WhatsappAuthStateHandle = {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearSession: () => Promise<void>;
  store: WhatsappAuthStore;
  persistent: boolean;
};

type AuthRow = EncryptedWhatsappAuthValue & {
  key_type: string;
  key_id: string;
};

type StoredMutation = AuthRow;

type AuthStateOptions = {
  organizationId: string;
  sessionName: string;
  store?: WhatsappAuthStore;
  encryptionKey?: string;
  authPath?: string;
  diskPath?: string;
};

const CREDS_TYPE = "creds";
const CREDS_ID = "primary";

function environmentValue(name: string): string {
  return String(process.env[name] || "").trim();
}

function authContext(
  organizationId: string,
  sessionName: string,
  keyType: string,
  keyId: string,
): string {
  return [organizationId, sessionName, keyType, keyId].join("\u001f");
}

async function loadRows(
  client: PoolClient,
  organizationId: string,
  sessionName: string,
  keyType: string,
  keyIds: string[],
): Promise<AuthRow[]> {
  if (!keyIds.length) return [];
  const result = await client.query<AuthRow>(
    `SELECT key_type, key_id, ciphertext, iv, auth_tag AS "authTag"
       FROM whatsapp_auth_state
      WHERE organization_id = $1
        AND session_name = $2
        AND key_type = $3
        AND key_id = ANY($4::text[])`,
    [organizationId, sessionName, keyType, keyIds],
  );
  return result.rows;
}

async function applyMutations(
  client: PoolClient,
  organizationId: string,
  sessionName: string,
  upserts: StoredMutation[],
  deletes: Array<{ keyType: string; keyId: string }>,
): Promise<void> {
  if (upserts.length) {
    await client.query(
      `INSERT INTO whatsapp_auth_state (
         organization_id, session_name, key_type, key_id,
         ciphertext, iv, auth_tag, updated_at
       )
       SELECT $1, $2, mutation.key_type, mutation.key_id,
              mutation.ciphertext, mutation.iv, mutation.auth_tag, now()
         FROM UNNEST(
           $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]
         ) AS mutation(key_type, key_id, ciphertext, iv, auth_tag)
       ON CONFLICT (organization_id, session_name, key_type, key_id)
       DO UPDATE SET
         ciphertext = EXCLUDED.ciphertext,
         iv = EXCLUDED.iv,
         auth_tag = EXCLUDED.auth_tag,
         updated_at = now()`,
      [
        organizationId,
        sessionName,
        upserts.map((item) => item.key_type),
        upserts.map((item) => item.key_id),
        upserts.map((item) => item.ciphertext),
        upserts.map((item) => item.iv),
        upserts.map((item) => item.authTag),
      ],
    );
  }

  if (deletes.length) {
    await client.query(
      `DELETE FROM whatsapp_auth_state
        WHERE organization_id = $1
          AND session_name = $2
          AND (key_type, key_id) IN (
            SELECT mutation.key_type, mutation.key_id
              FROM UNNEST($3::text[], $4::text[])
                AS mutation(key_type, key_id)
          )`,
      [
        organizationId,
        sessionName,
        deletes.map((item) => item.keyType),
        deletes.map((item) => item.keyId),
      ],
    );
  }
}

async function createDatabaseAuthState(
  options: AuthStateOptions,
): Promise<WhatsappAuthStateHandle> {
  const keyMaterials = configuredWhatsappAuthKeyMaterials(
    options.encryptionKey,
  );
  const primaryKeyMaterial = keyMaterials[0];
  const decrypt = <T>(row: AuthRow, context: string): T => {
    let lastError: unknown = null;
    for (const keyMaterial of keyMaterials) {
      try {
        return decryptWhatsappAuthValue<T>(row, keyMaterial, context);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Não foi possível decifrar a sessão WhatsApp");
  };
  let mutationQueue: Promise<void> = Promise.resolve();
  const enqueueMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const load = async <T>(keyType: string, keyId: string): Promise<T | null> =>
    withTenantTransaction(options.organizationId, async (client) => {
      const rows = await loadRows(
        client,
        options.organizationId,
        options.sessionName,
        keyType,
        [keyId],
      );
      const row = rows[0];
      if (!row) return null;
      return decrypt<T>(
        row,
        authContext(
          options.organizationId,
          options.sessionName,
          keyType,
          keyId,
        ),
      );
    });

  const save = async (keyType: string, keyId: string, value: unknown) => {
    const context = authContext(
      options.organizationId,
      options.sessionName,
      keyType,
      keyId,
    );
    const encrypted = encryptWhatsappAuthValue(
      value,
      primaryKeyMaterial,
      context,
    );
    await withTenantTransaction(options.organizationId, async (client) => {
      await applyMutations(
        client,
        options.organizationId,
        options.sessionName,
        [{ key_type: keyType, key_id: keyId, ...encrypted }],
        [],
      );
    });
  };

  const creds =
    (await load<AuthenticationCreds>(CREDS_TYPE, CREDS_ID)) || initAuthCreds();
  if (!creds.registered && !creds.me) {
    await save(CREDS_TYPE, CREDS_ID, creds);
  }

  const keys: AuthenticationState["keys"] = {
    get: async <T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[],
    ) => {
      await mutationQueue;
      const rows = await withTenantTransaction(
        options.organizationId,
        (client) =>
          loadRows(
            client,
            options.organizationId,
            options.sessionName,
            type,
            ids,
          ),
      );
      const byId = new Map(rows.map((row) => [row.key_id, row]));
      const result: Partial<Record<string, SignalDataTypeMap[T]>> = {};
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) continue;
        let value = decrypt<SignalDataTypeMap[T]>(
          row,
          authContext(
            options.organizationId,
            options.sessionName,
            type,
            id,
          ),
        );
        if (type === "app-state-sync-key" && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(
            value as proto.Message.IAppStateSyncKeyData,
          ) as unknown as SignalDataTypeMap[T];
        }
        result[id] = value;
      }
      return result as Record<string, SignalDataTypeMap[T]>;
    },
    set: async (data: SignalDataSet) => {
      const upserts: StoredMutation[] = [];
      const deletes: Array<{ keyType: string; keyId: string }> = [];
      for (const type of Object.keys(data) as Array<
        keyof SignalDataTypeMap
      >) {
        const values = data[type];
        if (!values) continue;
        for (const [id, value] of Object.entries(values)) {
          if (value == null) {
            deletes.push({ keyType: type, keyId: id });
            continue;
          }
          const context = authContext(
            options.organizationId,
            options.sessionName,
            type,
            id,
          );
          upserts.push({
            key_type: type,
            key_id: id,
            ...encryptWhatsappAuthValue(
              value,
              primaryKeyMaterial,
              context,
            ),
          });
        }
      }
      await enqueueMutation(() =>
        withTenantTransaction(options.organizationId, async (client) => {
          await applyMutations(
            client,
            options.organizationId,
            options.sessionName,
            upserts,
            deletes,
          );
        }),
      );
    },
    clear: () =>
      enqueueMutation(() =>
        withTenantTransaction(options.organizationId, async (client) => {
          await client.query(
            `DELETE FROM whatsapp_auth_state
              WHERE organization_id = $1
                AND session_name = $2
                AND key_type <> $3`,
            [options.organizationId, options.sessionName, CREDS_TYPE],
          );
        }),
      ),
  };

  return {
    state: { creds, keys },
    saveCreds: () =>
      enqueueMutation(() => save(CREDS_TYPE, CREDS_ID, creds)),
    clearSession: () =>
      enqueueMutation(() =>
        withTenantTransaction(options.organizationId, async (client) => {
          await client.query(
            `DELETE FROM whatsapp_auth_state
              WHERE organization_id = $1 AND session_name = $2`,
            [options.organizationId, options.sessionName],
          );
        }),
      ),
    store: "database",
    persistent: true,
  };
}

function safeFilesystemAuthPath(authPath: string): string {
  const resolved = path.resolve(authPath);
  const root = path.parse(resolved).root;
  if (resolved === root || path.dirname(resolved) === root) {
    throw new Error("WHATSAPP_AUTH_PATH é amplo demais para armazenar a sessão");
  }
  return resolved;
}

async function createFilesystemAuthState(
  options: AuthStateOptions,
): Promise<WhatsappAuthStateHandle> {
  const authPath = safeFilesystemAuthPath(
    options.authPath || environmentValue("WHATSAPP_AUTH_PATH") || ".whatsapp_auth",
  );
  const multiFile = await createMultiFileAuthState(authPath);
  return {
    ...multiFile,
    clearSession: () => rm(authPath, { recursive: true, force: true }),
    store: "filesystem",
    persistent: configuredWhatsappAuthPersistence({
      WHATSAPP_AUTH_STORE: "filesystem",
      WHATSAPP_AUTH_PATH: authPath,
      RENDER_DISK_PATH:
        options.diskPath || environmentValue("RENDER_DISK_PATH"),
    }),
  };
}

export async function createWhatsappAuthState(
  options: AuthStateOptions,
): Promise<WhatsappAuthStateHandle> {
  const store = options.store || configuredWhatsappAuthStore();
  return store === "database"
    ? createDatabaseAuthState(options)
    : createFilesystemAuthState(options);
}
