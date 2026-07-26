import test from "node:test";
import assert from "node:assert/strict";
import { canonicalFrontendLocation } from "../../lib/frontend-location";

test("direciona as telas duplicadas do backend ao frontend canônico", () => {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    FRONTEND_URL: "https://mavo-talk-web.onrender.com/",
  };

  assert.equal(
    canonicalFrontendLocation("/inbox", environment),
    "https://mavo-talk-web.onrender.com/inbox",
  );
});

test("usa a SPA canônica também durante desenvolvimento", () => {
  assert.equal(
    canonicalFrontendLocation("/", {
      NODE_ENV: "development",
      FRONTEND_URL: "http://localhost:5173",
    }),
    "http://localhost:5173/",
  );
});
