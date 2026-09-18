// Flache ESLint-Konfiguration (ESLint 9) mit typescript-eslint.
// Ziel: die Konventionen aus CLAUDE.md/docs/10 maschinell durchsetzen —
// kein `any` in Signaturen (die eine bewusste Ausnahme ist inline annotiert),
// keine ungenutzten Bindungen. Formatierung übernimmt Prettier, deshalb
// schaltet eslint-config-prettier alle stilistischen Regeln ab.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", ".render/**", "**/*.tsbuildinfo"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Kein streuendes Logging im Anwendungscode. Bewusste Startmeldungen in
      // apps/*/main.ts sind einzeln per eslint-disable-next-line ausgenommen.
      "no-console": "error",
    },
  },
  {
    // Node-Skripte und Konfigurationsdateien laufen außerhalb des TS-Builds.
    // Sie dürfen auf die Konsole schreiben; das Muster `cond ? ok() : fail()`
    // ist hier ein bewusstes Ausdrucks-Idiom mit Seiteneffekten.
    files: ["scripts/**/*.mjs", "*.mjs", "*.config.{js,ts}", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
    },
  },
  {
    // render-check.mjs führt Code im Browserkontext aus (page.evaluate).
    files: ["scripts/render-check.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
);
