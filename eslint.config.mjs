import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noUngovernedStructure from "./eslint-rules/governed-components/no-ungoverned-structure.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".mma/**",
    ".forge-workspace/**",
    ".forge-exports/**",
    ".mock-db/**",
    ".e2e/**",
    "mockup/**",
    "scripts/pdf-worker.mjs",
  ]),
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    files: ["app/**/*.tsx", "src/**/*.tsx"],
    plugins: {
      governed: {
        rules: {
          "no-ungoverned-structure": noUngovernedStructure,
        },
      },
    },
    rules: {
      "governed/no-ungoverned-structure": "error",
    },
  },
]);

export default eslintConfig;
