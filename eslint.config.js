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
  // JSFL is excluded: Espree cannot parse its top-level return fragments or syntax extensions.
  {
    files: ["server/**/*.ts", "server/**/*.mjs"],
    plugins: { jsdoc },
    rules: jsdocRules,
  },
  {
    languageOptions: { parser: tsParser },
    files: ["server/**/*.ts"],
  },
];
