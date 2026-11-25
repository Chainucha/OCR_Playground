import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

// Modular monolith. Each folder in src/modules/ is a module: other code imports it only through its index.ts, and a
// module imports only the modules listed here. Inside a module, files import each other with relative paths that stay
// inside the module.
const MODULES = {
  auth: [],
  documents: [],
  scoring: [],
  engines: ["scoring"],
  playground: ["auth", "documents", "engines", "scoring"],
};

// A module's core/ folder holds its rules in plain TypeScript, so they can be tested without a browser and move into
// an API later. No framework, browser library or app imports there; types from another module's index are fine.
const FRAMEWORK = [
  "next",
  "next/*",
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
  "radix-ui",
  "lucide-react",
  "aws-amplify",
  "aws-amplify/*",
  "@aws-amplify/*",
  "onnxruntime-web",
  "onnxruntime-web/*",
  "pdfjs-dist",
  "pdfjs-dist/*",
];

const deepImport = { regex: "^@/modules/[^/]+/", message: "Import a module through its index: @/modules/<name>." };
const appImport = { regex: "^@/app(/|$)", message: "Routes import modules, never the other way round." };

function moduleRules(name, allowed) {
  const others = { regex: `^@/modules/(?!(?:${allowed.join("|") || "-"})$)`, message: `${name} may import only: ${allowed.join(", ") || "no other module"}.` };
  // One entry per folder depth, so a relative import can never climb out of the module.
  return [1, 2, 3].map((depth) => ({
    files: [`src/modules/${name}/${"*/".repeat(depth - 1)}*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            deepImport,
            appImport,
            others,
            { regex: `^(\\.\\./){${depth}}`, message: `Stay inside the ${name} module, or import another module by its index.` },
          ],
        },
      ],
    },
  }));
}

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [deepImport] }] },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: "^@/(modules|app)(/|$)", message: "Shared code must not depend on modules or routes." }] },
      ],
    },
  },
  ...Object.entries(MODULES).flatMap(([name, allowed]) => moduleRules(name, allowed)),
  {
    files: ["src/modules/*/core/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: FRAMEWORK, message: "core/ is plain TypeScript: no framework or browser library imports." },
            { group: ["@/*"], allowTypeImports: true, message: "core/ may import types from other modules, not code." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-verify/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
