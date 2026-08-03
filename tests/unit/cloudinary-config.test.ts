import test from "node:test";
import assert from "node:assert/strict";
import { resolveCloudinaryConfig } from "../../lib/cloudinary";

const RENDER_ENV = {
  CLOUDINARY_CLOUD_NAME: "dgi1nxtb0",
  CLOUDINARY_API_KEY: "481615268712763",
  CLOUDINARY_API_SECRET: "secret-novo",
};

test("as variáveis explícitas vencem uma CLOUDINARY_URL antiga", () => {
  const config = resolveCloudinaryConfig({
    ...RENDER_ENV,
    CLOUDINARY_URL: "cloudinary://348613954995413:secret-antigo@dg1nxtb0",
  });

  assert.deepEqual(config, {
    cloudName: "dgi1nxtb0",
    apiKey: "481615268712763",
    apiSecret: "secret-novo",
    source: "env",
  });
});

test("usa CLOUDINARY_URL quando as variáveis explícitas não estão definidas", () => {
  const config = resolveCloudinaryConfig({
    CLOUDINARY_URL: "cloudinary://481615268712763:secret-novo@dgi1nxtb0",
  });

  assert.deepEqual(config, {
    cloudName: "dgi1nxtb0",
    apiKey: "481615268712763",
    apiSecret: "secret-novo",
    source: "url",
  });
});

test("não mistura fontes quando as variáveis explícitas estão incompletas", () => {
  const config = resolveCloudinaryConfig({
    CLOUDINARY_CLOUD_NAME: "dgi1nxtb0",
    CLOUDINARY_URL: "cloudinary://481615268712763:secret-novo@dgi1nxtb0",
  });

  assert.equal(config.apiKey, "481615268712763");
  assert.equal(config.apiSecret, "secret-novo");
  assert.equal(config.source, "url");
});

test("ignora o CLOUDINARY_URL de exemplo copiado do painel do Cloudinary", () => {
  const config = resolveCloudinaryConfig({
    ...RENDER_ENV,
    CLOUDINARY_URL: "cloudinary://<your_api_key>:<your_api_secret>@dgi1nxtb0",
  });

  assert.equal(config.apiKey, "481615268712763");
  assert.equal(config.source, "env");
});

test("aceita apenas o esquema cloudinary: e limpa aspas e espaços", () => {
  assert.equal(resolveCloudinaryConfig({ CLOUDINARY_URL: "https://481615268712763:secret@dgi1nxtb0" }).cloudName, "");
  assert.equal(resolveCloudinaryConfig({ CLOUDINARY_CLOUD_NAME: ' "dgi1nxtb0" ' }).cloudName, "dgi1nxtb0");
});

test("relata configuração ausente sem quebrar", () => {
  const config = resolveCloudinaryConfig({});
  assert.deepEqual(config, { cloudName: "", apiKey: "", apiSecret: "", source: "none" });
});
