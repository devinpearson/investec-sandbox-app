// Turns the Blockly examples into main.js, headlessly. Loaded on demand, so
// the code editor only pulls in Blockly when an example is opened.
// The full package, for the built-in blocks (variables, logic, loops…).
import * as Blockly from "blockly";
import {
  javascriptGenerator,
  type JavascriptGenerator,
} from "blockly/javascript";
import { installBlocks } from "../blocks";
import { examples } from "../examples";

const generator = javascriptGenerator as JavascriptGenerator;
installBlocks({ javascript: generator });

// JSDoc on each handler, so the editor knows what its argument holds.
const handlerDocs: [RegExp, string][] = [
  [
    /^const beforeTransaction = async \(authorization\) =>/m,
    "/**\n * Runs before the purchase is approved. Return false to decline it;\n * anything else (including nothing) approves it.\n * @param {Authorization} authorization\n */\n",
  ],
  [
    /^const afterTransaction = async \(transaction\) =>/m,
    "/**\n * Runs after an approved purchase.\n * @param {CardTransaction} transaction\n */\n",
  ],
  [
    /^const afterDecline = async \(transaction\) =>/m,
    "/**\n * Runs after a declined purchase.\n * @param {CardTransaction} transaction\n */\n",
  ],
];

export function documentHandlers(code: string): string {
  let out = code;
  for (const [pattern, doc] of handlerDocs) {
    out = out.replace(pattern, (match) => doc + match);
  }
  return out;
}

/** The example's card code, as the Blockly editor's Code tab shows it. */
export function exampleCode(name: string): string {
  const example = examples[name];
  if (!example) throw new Error(`No example called "${name}".`);
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(example.state, workspace);
    // Blockly leaves runs of blank lines after its declarations.
    const code = generator
      .workspaceToCode(workspace)
      .replace(/\n{3,}/g, "\n\n");
    return documentHandlers(code.trim()) + "\n";
  } finally {
    workspace.dispose();
  }
}
