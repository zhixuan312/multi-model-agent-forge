import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local, generated, and vendored trees that are NOT project source and must
    // never be linted (they produce tens of thousands of spurious violations,
    // e.g. minified `.next` chunks inside MMA worktrees):
    ".mma/**",            // MMA artifacts + execute-plan git worktrees (each has its own .next)
    ".forge-workspace/**", // generated Forge project workspaces (demo/user projects)
    ".forge-exports/**",   // generated PDF/zip export output
    ".mock-db/**",         // file-backed mock backend fixtures
    ".e2e/**",             // standalone e2e driver scripts
    "mockup/**",           // static design mockups, not app source
    "scripts/pdf-worker.mjs", // bundled standalone worker script
  ]),
  // Test code legitimately uses `any` for mocks, deliberately-malformed inputs,
  // and framework internals (mock proxies, transaction stubs). Production code
  // stays strict — `no-explicit-any` is enforced everywhere except here.
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // A leading underscore marks an intentionally-unused binding (e.g. a
  // signature-required handler arg). This is the standard convention.
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
]);

export default eslintConfig;
