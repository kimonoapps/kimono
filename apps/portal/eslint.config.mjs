import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "next/link", message: "Use Crossing so navigation has a transition." },
          { name: "@kimono/ui", importNames: ["SealLink"], message: "Use CrossingSeal from @/components/crossing." },
        ],
      }],
      "no-restricted-syntax": ["error", {
        selector: "JSXOpeningElement[name.name='a']",
        message: "Use Crossing or CrossingSeal; raw anchors bypass transitions.",
      }, {
        selector: "JSXOpeningElement[name.name='Door'] JSXAttribute[name.name='href']",
        message: "Use NavDoor or useCrossTo; Door href navigation is deprecated.",
      }, {
        selector: "CallExpression[callee.object.name='router'][callee.property.name=/^(push|replace|back|forward)$/]",
        message: "Route navigation through useCrossTo so it has a transition.",
      }, {
        selector: "CallExpression[callee.object.object.name='window'][callee.object.property.name='location'][callee.property.name=/^(assign|replace)$/]",
        message: "Route document navigation through useCrossTo so it has a transition.",
      }],
    },
  },
  {
    files: ["src/components/crossing.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
  globalIgnores([".next/**", "next-env.d.ts"]),
]);
