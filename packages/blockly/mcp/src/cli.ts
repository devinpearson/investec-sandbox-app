// investec-blockly-mcp — an MCP server for making Investec Blockly snippets
// with Claude, ChatGPT or any MCP client.
//
//   node mcp/dist/investec-blockly-mcp.cjs              stdio (Claude Desktop, Claude Code, Cursor…)
//   node mcp/dist/investec-blockly-mcp.cjs --http 3020  Streamable HTTP at /mcp (ChatGPT, remote clients)
//   node mcp/dist/investec-blockly-mcp.cjs reference    print the block reference as Markdown
//
// Both servers also manage the Investec Sandbox app's card code library (see
// store.ts) unless started with --no-library.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, defaultOptions } from "./server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blockReference, exampleFiles } from "./reference";
import { serveHttp } from "./http";
import { CardCodeStore, defaultStoreDir } from "./store";

const args = process.argv.slice(2);

/** Every value given for a repeatable --flag. */
const values = (flag: string) =>
  args.flatMap((arg, i) => (arg === flag && args[i + 1] ? [args[i + 1]!] : []));
const value = (flag: string) => values(flag).at(-1);

// The card code library (the desktop app's), unless --no-library.
const store = args.includes("--no-library")
  ? undefined
  : new CardCodeStore(value("--library") ?? defaultStoreDir());
const editorUrl = value("--editor-url");

async function serveStdio() {
  const server = createServer({
    ...defaultOptions(),
    ...(editorUrl ? { editorUrl } : {}),
    allowFiles: true,
    store,
  });
  await server.connect(new StdioServerTransport());
  console.error(
    `investec-blockly MCP server ready on stdio${store ? ` · card code library ${store.root}` : ""}`,
  );
}

function usage(code: number): never {
  console.error(`Usage:
  investec-blockly-mcp                 MCP over stdio
  investec-blockly-mcp --http [port]   MCP over Streamable HTTP at /mcp (default port 3020)
      --host <host>                    interface to listen on (default 127.0.0.1)
      --allow-origin <origin>          a web page origin that may call it (repeatable)
  --library <dir>                      the card code library (default: the Investec Sandbox app's)
  --no-library                         no library tools (snippets and share links only)
  --editor-url <url>                   editor that share links open
  investec-blockly-mcp reference       print the block reference (Markdown)
  investec-blockly-mcp skill-files <dir>  write the skill's reference.md and examples/

Environment:
  INVESTEC_BLOCKLY_URL  editor that share links open (default https://investec-blockly.vercel.app/)
  SIMULATOR_URL         investec-card-server for simulate_snippet (default http://localhost:3010)
  CARD_CODE_DIR         the card code library, if --library isn't given`);
  process.exit(code);
}

if (args.includes("--help") || args.includes("-h")) usage(0);

if (args[0] === "reference") {
  process.stdout.write(blockReference());
} else if (args[0] === "skill-files" && args[1]) {
  // Regenerates the skill's reference.md and examples/ from the blocks.
  const dir = args[1];
  mkdirSync(join(dir, "examples"), { recursive: true });
  writeFileSync(join(dir, "reference.md"), blockReference());
  for (const [file, contents] of Object.entries(exampleFiles())) {
    writeFileSync(join(dir, "examples", file), contents);
  }
  console.error(`Wrote ${dir}/reference.md and ${dir}/examples/`);
} else if (args.includes("--http")) {
  const given = args[args.indexOf("--http") + 1];
  const port =
    given && /^\d+$/.test(given)
      ? Number(given)
      : Number(process.env.PORT ?? 3020);
  serveHttp({
    ...defaultOptions(),
    ...(editorUrl ? { editorUrl } : {}),
    store,
    port,
    host: value("--host") ?? "127.0.0.1",
    // Without a library it's read-only snippet help: any page may use it.
    allowOrigins: values("--allow-origin").length
      ? values("--allow-origin")
      : ["*"],
  });
} else if (!args[0] || args[0].startsWith("--")) {
  serveStdio().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
} else {
  usage(1);
}
