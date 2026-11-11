import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  defaultTransaction,
  simulate,
  validateTransaction,
  type ExecutionItem,
  type TransactionInput,
} from "../../src/lib/simulator";
import { shareUrl } from "../../src/lib/share";
import {
  blockCatalogue,
  checkWorkspace,
  examples,
  templates,
  type BlockInfo,
  type CheckResult,
} from "./engine";
import { SNIPPET_FORMAT } from "./format";
import { Script } from "node:vm";
import { CardCodeStore, StoreError, type Project } from "./store";

export type ServerOptions = {
  /** Where share links open. */
  editorUrl: string;
  /** investec-card-server, for simulate_snippet. */
  simulatorUrl: string;
  /** Allow writing snippet files (local stdio use only). */
  allowFiles: boolean;
  /** The card code library shared with the desktop app's editors. */
  store?: CardCodeStore;
};

export const defaultOptions = (): ServerOptions => ({
  editorUrl:
    process.env.INVESTEC_BLOCKLY_URL ?? "https://investec-blockly.vercel.app/",
  simulatorUrl: process.env.SIMULATOR_URL ?? "http://localhost:3010",
  allowFiles: false,
});

const INSTRUCTIONS = `Investec Blockly builds programmable-card code for Investec cards from Blockly blocks. A snippet is a Blockly workspace (JSON) with up to three handler blocks — before transaction (approve/decline), after transaction and after decline — that the user opens in the editor.

Workflow for making a snippet:
1. Read the snippet format (resource investec-blockly://format, or the format section of list_blocks) and look up blocks with list_blocks / get_block. Start from get_example or list_templates when one is close.
2. Write the workspace JSON and call check_snippet. Fix every error and placement warning it reports, then check again.
3. If the user runs investec-card-server locally, call simulate_snippet with a few transactions to show it approving/declining as intended.
4. Call share_snippet and give the user the link. It opens the snippet in the editor, where they can adjust it and copy the generated code to their card.

The Investec Sandbox desktop app also keeps a card code library that these tools manage (list_card_code, get_card_code, create_card_code, update_card_code, edit_main_js, rename_card_code, delete_card_code, run_card_code, open_card_code). Each project is either "blocks" (a Blockly workspace, opened in Card blocks; its main.js is generated) or "code" (hand-written JavaScript in main.js, opened in Card code). Both have an env.json of environment variables. Prefer saving work as a project and calling open_card_code so the user sees it in the app; use share_snippet only for the web editor.

Only use block types and field values that list_blocks reports. Card code runs in Investec's sandbox with fetch, moment and process.env but no other libraries; secrets belong in environment variables (investec_env blocks), never in the snippet.`;

const json = (value: unknown) => JSON.stringify(value, null, 2);
const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
});

/** A one-line signature for list_blocks. */
function summarise(block: BlockInfo): string {
  const shape =
    block.output !== false
      ? `value${block.output ? ` → ${block.output.join("|")}` : ""}`
      : block.previousStatement || block.nextStatement
        ? "statement"
        : "handler";
  return `- ${block.type} (${shape}): ${block.text.replace(/\s+/g, " ")}${block.tooltip ? ` — ${block.tooltip}` : ""}`;
}

function describeCheck(result: CheckResult): string {
  const lines = [
    result.ok
      ? "✅ The snippet loads in the editor."
      : "❌ The snippet has errors.",
  ];
  for (const problem of result.problems) {
    const where = problem.blockId ? ` [block ${problem.blockId}]` : "";
    lines.push(`- ${problem.severity}${where}: ${problem.message}`);
  }
  if (result.code)
    lines.push("", "Generated card code:", "```js", result.code.trim(), "```");
  return lines.join("\n");
}

function describeRun(
  transaction: TransactionInput,
  items: ExecutionItem[],
): string {
  const decision = items.find((item) => item.type === "before_transaction");
  const lines = [
    `Transaction: R${(transaction.centsAmount / 100).toFixed(2)} ${transaction.currencyCode.toUpperCase()} at ${transaction.merchantName} (${transaction.merchantCity}, ${transaction.merchantCountry}), MCC ${transaction.merchantCode}`,
    `Decision: ${decision ? (decision.authorizationApproved ? "approved" : "declined") : "approved (no before transaction handler)"}`,
  ];
  for (const item of items) {
    lines.push(`${item.type}:`);
    if (!item.logs.length) lines.push("  (no logs)");
    for (const log of item.logs) lines.push(`  [${log.level}] ${log.content}`);
  }
  return lines.join("\n");
}

/** Runs code against each transaction on the card server. */
async function runTransactions(
  code: string,
  transactions: Partial<TransactionInput>[] | undefined,
  env: Record<string, string>,
  simulatorUrl: string,
): Promise<{ text: string; isError?: boolean }> {
  const runs: string[] = [];
  for (const override of transactions?.length ? transactions : [{}]) {
    const transaction = { ...defaultTransaction, ...override };
    const invalid = validateTransaction(transaction);
    if (invalid) {
      runs.push(`Skipped a transaction: ${invalid}`);
      continue;
    }
    try {
      const items = await simulate(code, transaction, env, simulatorUrl);
      runs.push(describeRun(transaction, items));
    } catch (e) {
      return {
        text: `${(e as Error).message}\nIn the Investec Sandbox app the card server starts with the app; otherwise start investec-card-server (https://github.com/devinpearson/investec-card-server).`,
        isError: true,
      };
    }
  }
  return { text: runs.join("\n\n") };
}

/** A syntax check of hand-written card code, with the line of the error. */
function syntaxError(code: string): string | null {
  try {
    new Script(code, { filename: "main.js" });
    return null;
  } catch (e) {
    const stack = String((e as Error).stack ?? "");
    const line = /main\.js:(\d+)/.exec(stack)?.[1];
    return `${(e as Error).message}${line ? ` (main.js line ${line})` : ""}`;
  }
}

function describeProject(project: Project, { full = false } = {}): string {
  const lines = [
    `# ${project.name} (${project.kind === "blocks" ? "blocks — Card blocks editor" : "JavaScript — Card code editor"})`,
    project.description ? project.description : "",
    `id: ${project.id} · updated ${project.updatedAt}`,
    "",
    "env.json:",
    "```json",
    JSON.stringify(project.env, null, 2),
    "```",
    "",
    project.kind === "blocks"
      ? "main.js (generated from the blocks):"
      : "main.js:",
    "```js",
    project.main.trimEnd(),
    "```",
  ];
  if (full && project.kind === "blocks") {
    lines.push(
      "",
      "workspace.json:",
      "```json",
      JSON.stringify(project.workspace),
      "```",
    );
  }
  return lines.filter((line, i) => line !== "" || i > 1).join("\n");
}

const workspaceSchema = z
  .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .describe(
    'The Blockly workspace: { "blocks": { "languageVersion": 0, "blocks": [ …handler blocks… ] } }, as an object or JSON string.',
  );

const transactionSchema = z
  .object({
    centsAmount: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Amount in cents, e.g. 25000 for R250"),
    currencyCode: z
      .string()
      .optional()
      .describe("Lower-case ISO currency, e.g. zar, usd"),
    merchantCode: z
      .string()
      .optional()
      .describe("Merchant category code (MCC), e.g. 5542 for fuel"),
    merchantName: z.string().optional(),
    merchantCity: z.string().optional(),
    merchantCountry: z
      .string()
      .optional()
      .describe("ISO 3166 alpha-2, e.g. ZA, US"),
  })
  .describe(
    "Fields to override on the default test transaction (R10 at Test Merchant, Cape Town, ZA)",
  );

export function createServer(
  options: ServerOptions = defaultOptions(),
): McpServer {
  const server = new McpServer(
    { name: "investec-blockly", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerResource(
    "snippet-format",
    "investec-blockly://format",
    {
      title: "Snippet format",
      description:
        "How an Investec Blockly snippet (workspace JSON) is structured",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, text: SNIPPET_FORMAT }] }),
  );

  server.registerTool(
    "list_blocks",
    {
      title: "List blocks",
      description:
        "Every block the editor offers, grouped by toolbox category, with the snippet format. Call get_block for a block's fields and inputs.",
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe(
            "Only this category, e.g. Card, Templates, HTTP, Date & time, Logic",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ category }) => {
      const blocks = blockCatalogue().filter(
        (block) =>
          !category || block.category.toLowerCase() === category.toLowerCase(),
      );
      const byCategory = new Map<string, BlockInfo[]>();
      for (const block of blocks) {
        byCategory.set(block.category, [
          ...(byCategory.get(block.category) ?? []),
          block,
        ]);
      }
      const sections = [...byCategory].map(
        ([name, list]) => `## ${name}\n${list.map(summarise).join("\n")}`,
      );
      return text(
        [
          category ? "" : SNIPPET_FORMAT,
          ...sections,
          category
            ? ""
            : "\nReady-made rules are available from list_templates.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    },
  );

  server.registerTool(
    "get_block",
    {
      title: "Get block",
      description:
        "Fields (with allowed dropdown values), inputs (with type checks), connections, placement rule and an example state for one or more block types.",
      inputSchema: {
        types: z
          .array(z.string())
          .min(1)
          .describe('Block types, e.g. ["investec_amount_compare"]'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ types }) => {
      const catalogue = blockCatalogue();
      return text(
        json(
          types.map(
            (type) =>
              catalogue.find((block) => block.type === type) ?? {
                type,
                error: "Unknown block type — see list_blocks.",
              },
          ),
        ),
      );
    },
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description:
        "Ready-made rule and notification blocks from the editor's Templates category (decline rules, Airtable, webhooks, ntfy, WhatsApp, Slack, Telegram), as block JSON to drop into a handler's STACK.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      text(
        templates()
          .map(
            (template) =>
              `### ${template.section} — ${template.title}\n\`\`\`json\n${JSON.stringify(template.block)}\n\`\`\``,
          )
          .join("\n\n"),
      ),
  );

  server.registerTool(
    "list_examples",
    {
      title: "List examples",
      description:
        "The example snippets in the editor, with what each one does.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      text(
        Object.entries(examples)
          .map(
            ([name, example]) =>
              `- ${name}: ${example.guide?.summary ?? ""}${example.env?.length ? ` (env: ${example.env.join(", ")})` : ""}`,
          )
          .join("\n"),
      ),
  );

  server.registerTool(
    "get_example",
    {
      title: "Get example",
      description:
        "One example snippet: its workspace JSON, the environment variables it reads, and its write-up (steps, setup, test scenarios).",
      inputSchema: {
        name: z.string().describe("Example name from list_examples"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const key = Object.keys(examples).find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase(),
      );
      if (!key) {
        return {
          ...text(
            `No example "${name}". Examples: ${Object.keys(examples).join(", ")}`,
          ),
          isError: true,
        };
      }
      const example = examples[key]!;
      return text(
        json({
          name: key,
          env: example.env ?? [],
          guide: example.guide,
          workspace: example.state,
        }),
      );
    },
  );

  server.registerTool(
    "check_snippet",
    {
      title: "Check snippet",
      description:
        "Loads the workspace exactly as the editor would, reports errors (unknown blocks, bad fields or values, wrong connections, duplicate handlers) and placement warnings, and returns the generated card code.",
      inputSchema: { workspace: workspaceSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ workspace }) => text(describeCheck(checkWorkspace(workspace))),
  );

  server.registerTool(
    "simulate_snippet",
    {
      title: "Simulate snippet",
      description:
        "Runs the snippet's code against test transactions on investec-card-server (the local Investec card simulator) and reports approve/decline and the logs of each handler. HTTP blocks really send their requests.",
      inputSchema: {
        workspace: workspaceSchema,
        transactions: z
          .array(transactionSchema)
          .max(10)
          .optional()
          .describe("Test transactions; defaults to one R10 purchase"),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Environment variables the code reads, e.g. {"MAX_SPEND": "500"}',
          ),
      },
      annotations: { openWorldHint: true },
    },
    async ({ workspace, transactions, env }) => {
      const result = checkWorkspace(workspace);
      if (!result.ok) return { ...text(describeCheck(result)), isError: true };
      const run = await runTransactions(
        result.code,
        transactions,
        env ?? {},
        options.simulatorUrl,
      );
      return { ...text(run.text), isError: run.isError };
    },
  );

  server.registerTool(
    "share_snippet",
    {
      title: "Share snippet",
      description:
        "Checks the snippet and returns a link that opens it in the Investec Blockly editor. Give the link to the user.",
      inputSchema: {
        workspace: workspaceSchema,
        name: z
          .string()
          .optional()
          .describe('Short name shown when it opens, e.g. "Fuel only"'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspace, name }) => {
      const result = checkWorkspace(workspace);
      if (!result.ok || !result.workspace) {
        return { ...text(describeCheck(result)), isError: true };
      }
      const url = await shareUrl(options.editorUrl, result.workspace, name);
      const warnings = result.problems.length
        ? `\n\nWarnings:\n${result.problems.map((problem) => `- ${problem.message}`).join("\n")}`
        : "";
      return text(`Open in Investec Blockly: ${url}${warnings}`);
    },
  );

  if (options.allowFiles) {
    server.registerTool(
      "save_snippet",
      {
        title: "Save snippet",
        description:
          "Checks the snippet and writes it as a .json file the user can load with the editor's Import button.",
        inputSchema: {
          workspace: workspaceSchema,
          path: z
            .string()
            .describe("File path to write, e.g. ./fuel-only.json"),
        },
        annotations: { destructiveHint: false },
      },
      async ({ workspace, path }) => {
        const result = checkWorkspace(workspace);
        if (!result.ok || !result.workspace) {
          return { ...text(describeCheck(result)), isError: true };
        }
        const file = resolve(path.endsWith(".json") ? path : `${path}.json`);
        await writeFile(file, json(result.workspace) + "\n");
        return text(`Saved ${file}. Open it with Import in the editor.`);
      },
    );
  }

  if (options.store) registerLibrary(server, options, options.store);

  return server;
}

const envSchema = z
  .record(z.string(), z.string())
  .describe(
    'Environment variables, e.g. {"MAX_SPEND": "500"} — read as process.env.MAX_SPEND',
  );

const nameSchema = z
  .string()
  .describe("The project's name (or id), from list_card_code");

function registerLibrary(
  server: McpServer,
  options: ServerOptions,
  store: CardCodeStore,
) {
  // Store errors (unknown project, bad name…) come back as tool errors.
  const guard =
    <A>(
      fn: (args: A) => Promise<{
        content: { type: "text"; text: string }[];
        isError?: boolean;
      }>,
    ) =>
    async (args: A) => {
      try {
        return await fn(args);
      } catch (e) {
        if (e instanceof StoreError)
          return { ...text(e.message), isError: true };
        throw e;
      }
    };

  /** Validates a workspace; the problems as an error result, or the result. */
  const compile = (workspace: unknown) => {
    const result = checkWorkspace(workspace);
    return result.ok && result.workspace
      ? { result }
      : { error: { ...text(describeCheck(result)), isError: true } };
  };

  const exampleKey = (name: string) =>
    Object.keys(examples).find(
      (key) => key.toLowerCase() === name.toLowerCase(),
    );

  server.registerTool(
    "list_card_code",
    {
      title: "List card code",
      description:
        "The projects in the Investec Sandbox app's card code library: name, kind (blocks or code), description, environment variable names and when each was last changed.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const projects = store.list();
      if (!projects.length) {
        return text(
          `The card code library is empty (${store.root}). Make one with create_card_code.`,
        );
      }
      return text(
        projects
          .map(
            (p) =>
              `- ${p.name} [${p.kind}]${p.description ? ` — ${p.description}` : ""}${p.envKeys.length ? ` (env: ${p.envKeys.join(", ")})` : ""} · updated ${p.updatedAt}`,
          )
          .join("\n"),
      );
    }),
  );

  server.registerTool(
    "get_card_code",
    {
      title: "Get card code",
      description:
        "One project: its main.js, env.json and, for blocks projects, the workspace JSON to edit and pass back to update_card_code.",
      inputSchema: { name: nameSchema },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ name }: { name: string }) =>
      text(describeProject(store.get(name), { full: true })),
    ),
  );

  server.registerTool(
    "create_card_code",
    {
      title: "Create card code",
      description:
        'Saves a new project in the app\'s library. kind "blocks" takes a Blockly workspace (checked like check_snippet; it opens in Card blocks). kind "code" takes JavaScript for main.js (syntax-checked; it opens in Card code). Start from an editor example with from_example, or copy another project with copy_from — e.g. copy a blocks project into a "code" project to continue it in JavaScript.',
      inputSchema: {
        name: z.string().describe('A short name, e.g. "Fuel only"'),
        kind: z.enum(["blocks", "code"]),
        description: z.string().optional().describe("One line on what it does"),
        workspace: workspaceSchema.optional().describe("blocks: the workspace"),
        main: z
          .string()
          .optional()
          .describe(
            "code: main.js — defines beforeTransaction(authorization), afterTransaction(transaction) and/or afterDecline(transaction) as async functions",
          ),
        from_example: z
          .string()
          .optional()
          .describe("Start from this example (list_examples)"),
        copy_from: z
          .string()
          .optional()
          .describe("Start from this project in the library"),
        env: envSchema.optional(),
      },
    },
    guard(
      async (args: {
        name: string;
        kind: "blocks" | "code";
        description?: string;
        workspace?: unknown;
        main?: string;
        from_example?: string;
        copy_from?: string;
        env?: Record<string, string>;
      }) => {
        const sources = [
          args.workspace !== undefined || args.main !== undefined,
          Boolean(args.from_example),
          Boolean(args.copy_from),
        ];
        if (sources.filter(Boolean).length > 1) {
          return {
            ...text("Give one of workspace/main, from_example or copy_from."),
            isError: true,
          };
        }
        let env: Record<string, string> = {};
        let workspace: unknown;
        let main: string | undefined;
        let description = args.description;
        if (args.from_example) {
          const key = exampleKey(args.from_example);
          if (!key) {
            return {
              ...text(
                `No example "${args.from_example}". Examples: ${Object.keys(examples).join(", ")}`,
              ),
              isError: true,
            };
          }
          const example = examples[key]!;
          workspace = example.state;
          env = Object.fromEntries((example.env ?? []).map((k) => [k, ""]));
          description ??= example.guide?.summary;
        } else if (args.copy_from) {
          const source = store.get(args.copy_from);
          env = source.env;
          description ??= source.description;
          if (source.kind === "blocks") workspace = source.workspace;
          main = source.main;
          if (args.kind === "blocks" && source.kind === "code") {
            return {
              ...text(
                'A JavaScript project can\'t become blocks. Copy it as kind "code".',
              ),
              isError: true,
            };
          }
        } else {
          workspace = args.workspace;
          main = args.main;
        }
        env = { ...env, ...(args.env ?? {}) };

        if (args.kind === "blocks") {
          if (workspace === undefined) {
            return {
              ...text(
                "A blocks project needs a workspace, from_example or copy_from.",
              ),
              isError: true,
            };
          }
          const compiled = compile(workspace);
          if (compiled.error) return compiled.error;
          const project = store.create({
            name: args.name,
            kind: "blocks",
            description,
            workspace: compiled.result.workspace,
            main: compiled.result.code,
            env,
          });
          return text(
            `Created "${project.name}".\n\n${describeProject(project)}${warnings(compiled.result.problems)}`,
          );
        }

        // JavaScript: from the example's or blocks project's generated code.
        if (main === undefined && workspace !== undefined) {
          const compiled = compile(workspace);
          if (compiled.error) return compiled.error;
          main = compiled.result.code;
        }
        if (main === undefined) {
          return {
            ...text("A code project needs main, from_example or copy_from."),
            isError: true,
          };
        }
        const problem = syntaxError(main);
        if (problem)
          return {
            ...text(`main.js doesn't parse: ${problem}`),
            isError: true,
          };
        const project = store.create({
          name: args.name,
          kind: "code",
          description,
          main,
          env,
        });
        return text(
          `Created "${project.name}".\n\n${describeProject(project)}`,
        );
      },
    ),
  );

  server.registerTool(
    "update_card_code",
    {
      title: "Update card code",
      description:
        "Changes a project: a new workspace (blocks), a whole new main.js (code), its description, or its environment variables (env replaces env.json; set_env and remove_env change single variables). For a small change to main.js, edit_main_js is easier.",
      inputSchema: {
        name: nameSchema,
        workspace: workspaceSchema
          .optional()
          .describe("blocks: the whole new workspace"),
        main: z.string().optional().describe("code: the whole new main.js"),
        description: z.string().optional(),
        env: envSchema
          .optional()
          .describe("Replaces all environment variables"),
        set_env: envSchema
          .optional()
          .describe("Adds or changes these variables"),
        remove_env: z
          .array(z.string())
          .optional()
          .describe("Removes these variables"),
      },
    },
    guard(
      async (args: {
        name: string;
        workspace?: unknown;
        main?: string;
        description?: string;
        env?: Record<string, string>;
        set_env?: Record<string, string>;
        remove_env?: string[];
      }) => {
        const current = store.get(args.name);
        const patch: Parameters<CardCodeStore["update"]>[1] = {
          description: args.description,
        };
        let notes = "";
        if (current.kind === "blocks") {
          if (args.main !== undefined) {
            return {
              ...text(
                `"${current.name}" is a blocks project: its main.js is generated. Change the workspace, or copy it into a code project (create_card_code with copy_from).`,
              ),
              isError: true,
            };
          }
          if (args.workspace !== undefined) {
            const compiled = compile(args.workspace);
            if (compiled.error) return compiled.error;
            patch.workspace = compiled.result.workspace;
            patch.main = compiled.result.code;
            notes = warnings(compiled.result.problems);
          }
        } else {
          if (args.workspace !== undefined) {
            return {
              ...text(
                `"${current.name}" is a JavaScript project; pass main instead of a workspace.`,
              ),
              isError: true,
            };
          }
          if (args.main !== undefined) {
            const problem = syntaxError(args.main);
            if (problem)
              return {
                ...text(`main.js doesn't parse: ${problem}`),
                isError: true,
              };
            patch.main = args.main;
          }
        }
        if (args.env || args.set_env || args.remove_env) {
          const env = { ...(args.env ?? current.env), ...(args.set_env ?? {}) };
          for (const key of args.remove_env ?? []) delete env[key];
          patch.env = env;
        }
        const project = store.update(current.id, patch);
        return text(
          `Updated "${project.name}".\n\n${describeProject(project)}${notes}`,
        );
      },
    ),
  );

  server.registerTool(
    "edit_main_js",
    {
      title: "Edit main.js",
      description:
        "Replaces text in a JavaScript project's main.js: old_text must match exactly (including spaces) and only once, unless replace_all is set. The result must still parse.",
      inputSchema: {
        name: nameSchema,
        old_text: z.string().min(1),
        new_text: z.string(),
        replace_all: z.boolean().optional(),
      },
    },
    guard(
      async (args: {
        name: string;
        old_text: string;
        new_text: string;
        replace_all?: boolean;
      }) => {
        const current = store.get(args.name);
        if (current.kind !== "code") {
          return {
            ...text(
              `"${current.name}" is a blocks project; change its workspace with update_card_code.`,
            ),
            isError: true,
          };
        }
        const count = current.main.split(args.old_text).length - 1;
        if (count === 0)
          return {
            ...text(
              "old_text isn't in main.js. Call get_card_code for the current text.",
            ),
            isError: true,
          };
        if (count > 1 && !args.replace_all) {
          return {
            ...text(
              `old_text appears ${count} times; give more surrounding text or set replace_all.`,
            ),
            isError: true,
          };
        }
        const main = args.replace_all
          ? current.main.split(args.old_text).join(args.new_text)
          : current.main.replace(args.old_text, () => args.new_text);
        const problem = syntaxError(main);
        if (problem)
          return {
            ...text(
              `That edit would break main.js: ${problem}. Nothing was changed.`,
            ),
            isError: true,
          };
        const project = store.update(current.id, { main });
        return text(
          `Edited main.js of "${project.name}" (${args.replace_all ? count : 1} change${count > 1 && args.replace_all ? "s" : ""}).`,
        );
      },
    ),
  );

  server.registerTool(
    "rename_card_code",
    {
      title: "Rename card code",
      description: "Gives a project a new name.",
      inputSchema: { name: nameSchema, new_name: z.string() },
      annotations: { idempotentHint: true },
    },
    guard(async ({ name, new_name }: { name: string; new_name: string }) => {
      const project = store.rename(name, new_name);
      return text(`Renamed to "${project.name}".`);
    }),
  );

  server.registerTool(
    "delete_card_code",
    {
      title: "Delete card code",
      description:
        "Removes a project from the library. It's moved to the library's .trash folder, so it can be recovered by hand. Confirm with the user first.",
      inputSchema: { name: nameSchema },
      annotations: { destructiveHint: true },
    },
    guard(async ({ name }: { name: string }) => {
      const removed = store.remove(name);
      return text(
        `Deleted "${removed.name}". It was moved to ${removed.trashedTo}.`,
      );
    }),
  );

  server.registerTool(
    "run_card_code",
    {
      title: "Run card code",
      description:
        "Runs a project's main.js with its env.json against test transactions on the card server, and reports approve/decline and each handler's logs. fetch calls in the code really send their requests.",
      inputSchema: {
        name: nameSchema,
        transactions: z
          .array(transactionSchema)
          .max(10)
          .optional()
          .describe("Test transactions; defaults to one R10 purchase"),
        env: envSchema.optional().describe("Overrides for this run only"),
      },
      annotations: { openWorldHint: true },
    },
    guard(
      async (args: {
        name: string;
        transactions?: Partial<TransactionInput>[];
        env?: Record<string, string>;
      }) => {
        const project = store.get(args.name);
        if (!project.main.trim())
          return {
            ...text(`"${project.name}" has no code yet.`),
            isError: true,
          };
        const run = await runTransactions(
          project.main,
          args.transactions,
          { ...project.env, ...(args.env ?? {}) },
          options.simulatorUrl,
        );
        return { ...text(run.text), isError: run.isError };
      },
    ),
  );

  server.registerTool(
    "open_card_code",
    {
      title: "Open card code",
      description:
        "Shows the project in the Investec Sandbox app: blocks projects in Card blocks, JavaScript ones in Card code. The app must be running.",
      inputSchema: { name: nameSchema },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ name }: { name: string }) => {
      const project = store.requestOpen(name);
      return text(
        `Asked the Investec Sandbox app to open "${project.name}" in ${project.kind === "blocks" ? "Card blocks" : "Card code"}. If the app isn't running, it isn't shown; the project is saved either way.`,
      );
    }),
  );
}

function warnings(problems: { severity: string; message: string }[]): string {
  const list = problems.filter((p) => p.severity !== "error");
  return list.length
    ? `\n\nWarnings:\n${list.map((p) => `- ${p.message}`).join("\n")}`
    : "";
}
