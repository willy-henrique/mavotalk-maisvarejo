import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

const response = await fetch("https://render.com/schema/render.yaml.json");
if (!response.ok) {
  throw new Error(
    `Não foi possível obter o schema oficial do Render (${response.status})`,
  );
}

const schema = await response.json();
const blueprint = parse(await readFile("render.yaml", "utf8"));
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
});

if (!ajv.validate(schema, blueprint)) {
  console.error(JSON.stringify(ajv.errors, null, 2));
  process.exit(1);
}

console.log("render.yaml válido conforme o schema oficial do Render.");
