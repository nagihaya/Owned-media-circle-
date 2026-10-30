import globals from "globals";
export default [
  { ignores: ["node_modules/**", ".work/**"] },
  {
    files: ["server/**/*.mjs", "migrations/**/*.mjs", "test/**/*.mjs", "*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: { "no-undef": "error" },
  },
  {
    files: ["public/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: globals.browser,
    },
    rules: { "no-undef": "error" },
  },
];
