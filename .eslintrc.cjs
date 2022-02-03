module.exports = {
  env: { browser: true, node: true, jest: true },
  root: true,
  extends: ["eslint:recommended", "plugin:prettier/recommended"],
  parser: "@typescript-eslint/parser",
  plugins: [
    "@typescript-eslint",
    "unused-imports",
    "simple-import-sort",
    "import",
    "prettier",
  ],
  ignorePatterns: ["data/*"],
  parserOptions: {
    project: "./tsconfig.lint.json",
    tsconfigRootDir: __dirname,
    extraFileExtensions: [".cjs"],
  },
  overrides: [
    {
      files: "**/*.cjs",
      rules: {
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/strict-boolean-expressions": "off",
      },
    },
  ],
  rules: {
    // prettier
    "prettier/prettier": "error",
    "no-extra-semi": "off",
    "no-empty": "off",

    // related to the "unused-imports" plugin
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-imports-ts": "error",
    "unused-imports/no-unused-vars-ts": [
      "error",
      {
        vars: "all",
        varsIgnorePattern: "^_",
        args: "after-used",
        argsIgnorePattern: "^_",
      },
    ],

    // related to import sorting and ordering
    "sort-imports": "off",
    "import/order": "off",
    "no-multi-spaces": "error",
    "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 1 }],
    "simple-import-sort/imports": [
      "error",
      {
        groups: [
          ["^([^s.]|s($|[^r])|s($|[^r]$|r[^c])|sr($|c[^/]))"],
          ["^src"],
          ["."],
        ],
      },
    ],
    "import/first": "error",
    "import/newline-after-import": "error",
    "import/no-duplicates": ["error", { considerQueryString: true }],

    // typescript already enforces the following
    "no-undef": "off",

    // other
    "@typescript-eslint/strict-boolean-expressions": [
      "error",
      {
        allowString: true,
        allowNullableBoolean: true,
        allowNumber: true,
        allowNullableNumber: true,
        allowNullableString: true,
      },
    ],
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "no-constant-condition": "off",
    "require-atomic-updates": "off",
    "use-isnan": "error",
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "CallExpression[callee.name='setTimeout'][arguments.length!=2]",
        message: "setTimeout must always be invoked with two arguments.",
      },
      {
        selector:
          "CallExpression[callee.name='setInterval'][arguments.length!=2]",
        message: "setInterval must always be invoked with two arguments.",
      },
    ],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-empty-interface": "off",
    "@typescript-eslint/interface-name-prefix": "off",
    "@typescript-eslint/no-inferrable-types": "off",
    "@typescript-eslint/camelcase": "off",
    "@typescript-eslint/restrict-plus-operands": "error",
    "@typescript-eslint/no-explicit-any": "off",
  },
}
