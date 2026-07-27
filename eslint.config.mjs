import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["frontend/**/*.{js,jsx,ts,tsx}"],
    rules: {
      // A SPA é compilada pelo Vite; next/image não existe nesse runtime.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "frontend/dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    "next-env.d.ts",
    "server.cjs",
    "worker.mjs",
  ]),
]);

export default eslintConfig;
