import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("frame-ancestors é entregue por header, não por meta CSP", async () => {
  const [indexHtml, nextConfig, renderConfig] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("next.config.ts", "utf8"),
    readFile("render.yaml", "utf8"),
  ]);

  assert.doesNotMatch(indexHtml, /frame-ancestors/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(renderConfig, /frame-ancestors 'none'/);
});
