// Stylelint 最小配置（ocr 教科书组合审查 2026-11-16 用，未跟踪、不提交）
// 只开「真错误」类规则：未知属性、重复选择器、同块重复属性、空块、非法 hex、
// shorthand 覆盖 longhand、未知元素选择器。不含任何风格洁癖规则。
export default {
  rules: {
    "property-no-unknown": true,
    "declaration-block-no-duplicate-properties": [
      true,
      { ignore: ["consecutive-duplicates-with-different-values"] },
    ],
    "declaration-block-no-shorthand-property-overrides": true,
    "no-duplicate-selectors": true,
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "selector-type-no-unknown": [
      true,
      { ignoreTypes: ["/^xhhao-/", "/^astro-/"] },
    ],
  },
};
