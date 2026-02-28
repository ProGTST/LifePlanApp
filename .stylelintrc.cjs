/** @type {import('stylelint').Config} */
module.exports = {
  extends: ["stylelint-config-recommended"],
  ignoreFiles: ["node_modules/**", "dist/**", "**/*.min.css"],
  rules: {
    "declaration-no-important": true,
    "declaration-block-no-duplicate-properties": true,
    "block-no-empty": true,
    "no-descending-specificity": null,
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: ["tailwind", "apply", "variants", "responsive", "screen", "layer", "config"],
      },
    ],
  },
};
