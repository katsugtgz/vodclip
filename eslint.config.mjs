// @ts-check
import { defineConfig } from "eslint/config";
import js from "@eslint/js";

export default defineConfig([
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-constant-condition": "off",
    },
  },
  {
    ignores: ["node_modules/**", "web/dist/**", "dist/**"],
  },
]);
