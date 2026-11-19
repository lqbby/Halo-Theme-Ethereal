// ESLint 最小配置（ocr 教科书组合审查 2026-11-16 用，未跟踪、不提交）
// TS: @typescript-eslint recommended；Astro: eslint-plugin-astro flat/recommended
// + 脚本段委托 TS 解析器。只统计 error 级为正文结论，warning 单独计数。
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import astroPlugin from "eslint-plugin-astro";
import globals from "globals";

export default [
  {
    ignores: [
      "templates/**",
      "dist/**",
      "node_modules/**",
      "src/scripts/vendor/**",
      "**/*.min.js",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.browser },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { ...tsPlugin.configs.recommended.rules },
  },
  ...astroPlugin.configs["flat/recommended"],
  {
    files: ["**/*.astro"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tsParser },
    },
  },
];
