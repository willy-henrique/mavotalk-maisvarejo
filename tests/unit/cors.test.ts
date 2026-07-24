import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  configuredOrigins,
  isAllowedRequestOrigin,
}: {
  configuredOrigins(environment: NodeJS.ProcessEnv): string[];
  isAllowedRequestOrigin(
    origin: string,
    allowedOrigins: string[],
    headers: Record<string, string>,
  ): boolean;
} = require("../../lib/config/cors.cjs");

test("inclui frontend e a URL pública da própria API nas origens", () => {
  assert.deepEqual(
    configuredOrigins({
      NODE_ENV: "production",
      FRONTEND_URL: "https://mavo-talk-web.onrender.com/",
      TWILIO_WEBHOOK_BASE_URL: "https://mavo-talk-api.onrender.com",
    }),
    [
      "https://mavo-talk-web.onrender.com",
      "https://mavo-talk-api.onrender.com",
    ],
  );
});

test("permite a própria origem recebida pelo proxy sem liberar terceiros", () => {
  const headers = {
    host: "mavo-talk-api.onrender.com",
    "x-forwarded-proto": "https",
  };

  assert.equal(
    isAllowedRequestOrigin(
      "https://mavo-talk-api.onrender.com",
      ["https://mavo-talk-web.onrender.com"],
      headers,
    ),
    true,
  );
  assert.equal(
    isAllowedRequestOrigin(
      "https://site-malicioso.example",
      ["https://mavo-talk-web.onrender.com"],
      headers,
    ),
    false,
  );
});
