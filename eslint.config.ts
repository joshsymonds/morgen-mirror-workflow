import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  // ── Ignores ──────────────────────────────────────────────
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**", "*.config.ts"],
  },

  // ── Base presets ─────────────────────────────────────────
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  unicorn.configs.recommended,
  sonarjs.configs.recommended,
  prettier, // Last preset — disables formatting rules

  // ── Parser settings ──────────────────────────────────────
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
  },

  // ── All TypeScript files ─────────────────────────────────
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    plugins: { perfectionist },
    rules: {
      // ── Correctness ──────────────────────────────────────
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // ── Type safety ──────────────────────────────────────
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      // Allow `${something:number}` in template literals — universally
      // representable, and the workflow code mixes uids with unix
      // timestamps in hash inputs.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],

      // ── Unused code ──────────────────────────────────────
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // ── Complexity caps ──────────────────────────────────
      "sonarjs/cognitive-complexity": ["error", 15],
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-lines-per-function": [
        "error",
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
      "max-nested-callbacks": ["error", 3],

      // ── Naming ───────────────────────────────────────────
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"] },
        { selector: "variable", format: ["camelCase", "UPPER_CASE"] },
        {
          selector: "variable",
          modifiers: ["const", "exported"],
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
        },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase"] },
        { selector: "property", format: null },
        { selector: "import", format: null },
      ],

      // ── Print statements ─────────────────────────────────
      // Workflow uses morgen.util.log; deploy script uses
      // console.info/error which we allow on a case-by-case basis.
      "no-console": "error",

      // ── Comment hygiene ──────────────────────────────────
      "no-warning-comments": [
        "warn",
        { terms: ["fixme", "hack", "xxx", "bug"] },
      ],
      "sonarjs/todo-tag": "warn",

      // ── Import organization ──────────────────────────────
      "perfectionist/sort-imports": [
        "error",
        {
          type: "natural",
          groups: [
            "builtin",
            { newlinesBetween: 1 },
            "external",
            { newlinesBetween: 1 },
            "internal",
            "parent",
            "sibling",
            "index",
          ],
        },
      ],
      "perfectionist/sort-named-imports": ["error", { type: "natural" }],
      "perfectionist/sort-exports": ["error", { type: "natural" }],

      // ── General quality ──────────────────────────────────
      eqeqeq: ["error", "always"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "prefer-const": "error",
      "no-var": "error",
      "object-shorthand": "error",
      "prefer-template": "error",

      // ── Unicorn overrides ────────────────────────────────
      "unicorn/no-null": "off", // null is idiomatic in Morgen's JSCalendar payloads
      "unicorn/prevent-abbreviations": [
        "error",
        {
          // Domain terms that mirror Morgen's bundle / API field names
          // verbatim — renaming would break the analogy to the
          // upstream code we're interoperating with.
          allowList: {
            iCalUidHash: true,
          },
          replacements: {
            args: false,
            config: false,
            ctx: false,
            db: false,
            dest: false, // shorter and clearer than "destination" for cal pairs
            env: false,
            err: false,
            fn: false,
            msg: false,
            params: false,
            props: false,
            ref: false, // Morgen domain term: Ref-Group-Id
            req: false,
            res: false,
          },
        },
      ],
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
    },
  },

  // ── Cryptographic / low-level encoding modules ───────────
  // FIPS 180-4 SHA-256 and the base62 encoder use standard
  // single-letter register names (a..h, i, j, w, k, t1, t2). The
  // spec is the canonical reference; renaming hurts review.
  {
    files: ["src/lib/sha256.ts", "src/lib/base62.ts"],
    rules: {
      "unicorn/prevent-abbreviations": "off",
      "max-lines-per-function": "off",
      "sonarjs/cognitive-complexity": "off",
    },
  },

  // ── Test-specific relaxations ────────────────────────────
  {
    files: ["test/**/*.ts"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,

      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/naming-convention": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-duplicate-string": "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      "unicorn/consistent-function-scoping": "off",
      complexity: "off",
      "no-console": "off",
    },
  },
);
