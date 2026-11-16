import jsdoc from "eslint-plugin-jsdoc";
import tsParser from "@typescript-eslint/parser";

const namedFunctionContexts = [
  "FunctionDeclaration[id.name]",
  "VariableDeclarator > ArrowFunctionExpression",
  "VariableDeclarator > FunctionExpression",
  "MethodDefinition",
];

const jsdocRules = {
  "jsdoc/require-description": ["error", { contexts: namedFunctionContexts }],
  "jsdoc/require-jsdoc": [
    "error",
    {
      require: {
        ArrowFunctionExpression: false,
        FunctionDeclaration: false,
        FunctionExpression: false,
        MethodDefinition: false,
      },
      contexts: namedFunctionContexts,
    },
  ],
  "jsdoc/require-param": ["error", { contexts: namedFunctionContexts }],
  "jsdoc/require-param-description": ["error", { contexts: namedFunctionContexts }],
  "jsdoc/require-returns": ["error", { contexts: namedFunctionContexts }],
};

export default [
  {
    files: ["server/**/*.ts", "server/**/*.mjs"],
    plugins: { jsdoc },
    rules: jsdocRules,
  },
  {
    files: ["server/jsfl/**/*.jsfl"],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: "script",
      parserOptions: { ecmaFeatures: { globalReturn: true } },
    },
    plugins: { jsdoc },
    rules: {
      ...jsdocRules,
      "no-restricted-globals": ["error", { name: "JSON", message: "JSFL does not provide the JSON global." }],
    },
  },
  {
    languageOptions: { parser: tsParser },
    files: ["server/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression[typeAnnotation.type='TSNeverKeyword']",
          message: "Do not use `as never` to bypass type checking; use a properly typed adapter.",
        },
      ],
    },
  },
];
