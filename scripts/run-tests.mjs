import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const testRoot = path.resolve("tests");

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTests(absolute);
      return entry.isFile() && entry.name.endsWith(".test.ts")
        ? [absolute]
        : [];
    }),
  );
  return nested.flat();
}

const testFiles = (await collectTests(testRoot)).sort();
if (!testFiles.length) {
  throw new Error("Nenhum arquivo de teste foi encontrado em tests/");
}

const tsxCli = require.resolve("tsx/cli");
const child = spawn(process.execPath, [tsxCli, "--test", ...testFiles], {
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
