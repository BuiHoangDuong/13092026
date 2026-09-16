import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";

const clientImportsRule = {
  meta: {
    type: "problem",
    messages: {
      serverPackage: "Client modules may import @cashback/contracts only; move this dependency behind a server boundary."
    },
    schema: []
  },
  create(context) {
    let clientModule = false;
    return {
      Program(node) {
        clientModule = node.body.some(
          (statement) => statement.type === "ExpressionStatement" && statement.directive === "use client"
        );
      },
      ImportDeclaration(node) {
        const source = String(node.source.value);
        if (clientModule && (source === "@cashback/core" || source.startsWith("@cashback/core/") || source === "@cashback/db" || source.startsWith("@cashback/db/"))) {
          context.report({ node, messageId: "serverPackage" });
        }
      }
    };
  }
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/generated/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { "import-x": importX },
    rules: { "@typescript-eslint/no-explicit-any": "off" }
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { boundaries: { rules: { "client-imports": clientImportsRule } } },
    rules: { "boundaries/client-imports": "error" }
  },
  {
    files: ["packages/contracts/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { "patterns": ["@cashback/*"] }]
    }
  },
  {
    files: ["packages/db/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { "patterns": ["@cashback/contracts", "@cashback/contracts/*", "@cashback/core", "@cashback/core/*"] }]
    }
  }
);
