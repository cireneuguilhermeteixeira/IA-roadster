export default [
  {
    ignores: ["dist/**"],
  },
  {
    files: ["src/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        document: "readonly",
        window: "readonly",
        innerWidth: "readonly",
        innerHeight: "readonly",
        devicePixelRatio: "readonly",
        addEventListener: "readonly",
        requestAnimationFrame: "readonly",
      },
    },
    rules: {
      eqeqeq: ["error", "always"],
      "no-constant-condition": "error",
      "no-undef": "error",
      "no-unused-vars": "error",
      "prefer-const": "error",
    },
  },
];
