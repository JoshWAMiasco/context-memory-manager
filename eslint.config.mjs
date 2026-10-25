import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import unicornPlugin from "eslint-plugin-unicorn";
import jsdocPlugin from "eslint-plugin-jsdoc";

const ALLOWED_FRAMEWORK_IDIOMS = {
  props: true,
  Props: true,
  ref: true,
  Ref: true,
  params: true,
  Params: true,
  args: false,
  env: true,
  dev: true,
  src: true,
  alt: true,
  href: true,
  rel: true,
  Url: true,
  url: true,
  i18n: true,
  db: false,
  /* The PDF guides' files: app/api/docs and the `docs:pdf` script. */
  docs: true,
};

const NEXT_SPECIAL_FILES = [
  "app/**/page.tsx",
  "app/**/layout.tsx",
  "app/**/loading.tsx",
  "app/**/error.tsx",
  "app/**/global-error.tsx",
  "app/**/not-found.tsx",
  "app/**/template.tsx",
  "app/**/default.tsx",
  "app/**/opengraph-image.tsx",
  "app/**/icon.tsx",
  "app/**/sitemap.ts",
  "app/**/robots.ts",
  "*.config.{js,mjs,ts,mts}",
  "next.config.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    plugins: { unicorn: unicornPlugin, jsdoc: jsdocPlugin },
    rules: {
      "unicorn/prevent-abbreviations": [
        "error",
        { allowList: ALLOWED_FRAMEWORK_IDIOMS, checkFilenames: true, checkProperties: false },
      ],
      "unicorn/filename-case": [
        "error",
        { case: "kebabCase", ignore: ["^README\\.md$", "^AGENTS\\.md$", "^\\[[a-zA-Z]+\\]$"] },
      ],
      "id-length": [
        "error",
        { min: 3, exceptions: ["id", "x", "y", "to", "as", "on", "is", "of", "_"], properties: "never" },
      ],
      "import/no-default-export": "error",
      "import/no-anonymous-default-export": "off",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "clsx", message: "Use mergeClassNames from @/utilities/merge-class-names." },
            { name: "tailwind-merge", message: "Use mergeClassNames from @/utilities/merge-class-names." },
          ],
          patterns: [
            {
              group: ["**/index", "@/components/*/index"],
              message: "Import from the component file directly; barrel files are not used.",
            },
          ],
        },
      ],
      "no-inline-comments": "error",
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "xxx", "hack"], location: "start" }],
      "multiline-comment-style": ["error", "starred-block"],
    },
  },
  {
    files: ["components/**/*.tsx", "hooks/**/*.ts", "utilities/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ArrowFunctionExpression: true, FunctionExpression: true },
          contexts: ["ExportNamedDeclaration > VariableDeclaration"],
        },
      ],
      "jsdoc/require-example": ["error", { contexts: ["ExportNamedDeclaration > FunctionDeclaration"] }],
      "jsdoc/no-types": "error",
      "jsdoc/check-tag-names": ["error", { definedTags: ["remarks"] }],
    },
  },
  {
    files: NEXT_SPECIAL_FILES,
    rules: { "import/no-default-export": "off" },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs,ts}", "server/entry.ts", "server/services.ts"],
    rules: { "import/no-default-export": "off", "no-console": "off" },
  },
  {
    files: ["scripts/stubs/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: [
      "components/data-grid/data-grid.tsx",
      "components/viewer/csv-table.tsx",
      "components/versioning/history-panel.tsx",
    ],
    rules: { "react-hooks/incompatible-library": "off" },
  },
  {
    files: ["utilities/merge-class-names.ts", "utilities/join-class-names.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "node_modules/**",
    "server/db/migrations/**",
    ".ccm-test-data/**",
    ".ccm-dev-data/**",
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
