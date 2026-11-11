// Monaco, bundled with the app (no CDN): the editor with its features
// (suggestions, hovers, find…), and only the JavaScript and JSON languages,
// each with its worker.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/edcore.main";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

import { cardCodeTypes } from "./cardTypes";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "javascript" || label === "typescript") return new TsWorker();
    return new EditorWorker();
  },
};

export const MAIN_URI = monaco.Uri.parse("file:///main.js");
export const ENV_URI = monaco.Uri.parse("file:///env.json");

const js = monaco.languages.typescript.javascriptDefaults;
js.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
  allowJs: true,
});
// Syntax errors only: card code is plain JavaScript, not type-checked.
js.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
});
js.addExtraLib(cardCodeTypes, "file:///card-code.d.ts");

monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  schemas: [
    {
      uri: "https://investec-sandbox.local/env.schema.json",
      fileMatch: [ENV_URI.toString()],
      schema: {
        type: "object",
        title: "Environment variables",
        description:
          "Read by the card code as process.env.NAME. Values are text, as on a real card.",
        additionalProperties: {
          type: "string",
          description: "Read as process.env.<name>",
        },
      },
    },
  ],
});

export { monaco };
