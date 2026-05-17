// @ts-check
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import stylistic from "@stylistic/eslint-plugin"
import globals from "globals"

// Style baseline tuned for compactness: no semicolons,
// 2-space indent, double quotes. Padding-line-between-statements
// is NOT enforced so deliberate blank lines stay.
const styleConfig = stylistic.configs.customize({
  indent: 2,
  quotes: "double",
  semi: false,
  jsx: false,
  arrowParens: true,
  braceStyle: "1tbs",
  blockSpacing: true,
  quoteProps: "as-needed",
  commaDangle: "always-multiline",
})

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "**/*.md"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  styleConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: "readonly",
      },
    },
    rules: {
      // Strict typing — `any` is a hole in the type system.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
)
