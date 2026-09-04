import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // GENERATED, AND IT WAS BEING LINTED — #383.
    //
    // `jest --coverage` writes an HTML report here containing three vendored
    // scripts (block-navigation.js, prettify.js, sorter.js). Linting somebody
    // else's minified reporter tells us nothing and, because the report only
    // exists after a coverage run, made `eslint .` give different answers on
    // different machines. .gitignore already excludes it.
    "coverage/**",
    // `scripts/**` USED TO BE IGNORED HERE — #328.
    //
    // The rationale was "One-off admin/maintenance scripts — not app code".
    // They are not app code; they are something with a wider blast radius. Half
    // of them import the same `db` the application does — which is the live
    // Supabase project — and write to it, by hand, with no request, no session
    // and no reviewer. tsconfig.json excluded the same directory, so these were
    // the only files in the repository outside BOTH gates.
    //
    // What that hid is in scripts/firebase-schema-fix.ts: it crashes on its
    // ninth line, and always has. Turning the typechecker on names the reason
    // in one second. Un-ignoring costs nothing here — every file in scripts/
    // passes lint as written.
  ]),
]);

export default eslintConfig;
