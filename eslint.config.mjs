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
  // React Compiler advisory rules (eslint-plugin-react-hooks v6). This codebase
  // has not adopted the React Compiler, and these rules flag many pre-existing,
  // functionally-correct patterns across the component layer. Run them as `warn`
  // (visible, not blocking) rather than a risky blanket refactor. The genuine
  // correctness rule — `rules-of-hooks` — stays at ERROR, and real bugs it and
  // `refs` surfaced (e.g. the SpecStageClient dedup race) were fixed, not muted.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/static-components": "warn",
    },
  },
]);

export default eslintConfig;
