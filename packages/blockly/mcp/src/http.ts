// The HTTP server: MCP over Streamable HTTP at /mcp, and — with a card code
// library — a small JSON API the desktop app's editors use for it, plus a
// stream of change events (/api/events) so an open editor shows what an AI
// assistant just saved.
//
// It only answers requests addressed to this machine by name (localhost,
// 127.0.0.1), which stops DNS-rebinding pages, and only lets the browser
// origins it was given (the app's editors) call it from a web page.
import { mkdirSync, watch } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { checkWorkspace } from "./engine";
import { createServer, type ServerOptions } from "./server";
import { OPEN_FILE, StoreError, type CardCodeStore } from "./store";

export type HttpOptions = ServerOptions & {
  port: number;
  host: string;
  /** Browser origins allowed to call the server; "*" allows any (no library only). */
  allowOrigins: string[];
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MAX_BODY = 2 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new StoreError("The request is too large.", 413));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new StoreError("The request body isn't valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

const sendJson = (res: ServerResponse, status: number, value: unknown) =>
  res
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify(value));

/** Change events from the library folder, for /api/events. */
function watchLibrary(store: CardCodeStore) {
  const clients = new Set<ServerResponse>();
  mkdirSync(store.root, { recursive: true });
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const send = (event: string, data: unknown) => {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(message);
  };
  try {
    watch(store.root, { recursive: true }, (_type, file) => {
      if (!file) return;
      pending.add(String(file).split(/[\\/]/)[0]!);
      clearTimeout(timer);
      // Writes come in bursts (main.js, env.json, card-code.json).
      timer = setTimeout(() => {
        const names = [...pending];
        pending = new Set();
        if (names.includes(OPEN_FILE)) {
          const request = store.readOpenRequest();
          if (request) send("open", request);
        }
        const ids = names.filter((name) => !name.startsWith("."));
        if (ids.length) send("changed", { ids });
      }, 150);
    });
  } catch (e) {
    console.error(`Not watching ${store.root}: ${(e as Error).message}`);
  }
  // Keeps idle connections open through proxies and sleeping laptops.
  setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, 25_000).unref();
  return {
    subscribe(res: ServerResponse) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      res.on("close", () => clients.delete(res));
    },
  };
}

/** The editors' API: /api/projects[/:id]. */
async function handleApi(
  store: CardCodeStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  const id = decodeURIComponent(path.slice("/api/projects/".length));
  const generated = (workspace: unknown) => checkWorkspace(workspace).code;
  if (path === "/api/projects") {
    if (req.method === "GET") return sendJson(res, 200, store.list());
    if (req.method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const kind = body.kind === "blocks" ? "blocks" : "code";
      const project = store.create({
        name: String(body.name ?? ""),
        kind,
        description:
          typeof body.description === "string" ? body.description : undefined,
        env: body.env as Record<string, string> | undefined,
        workspace: kind === "blocks" ? body.workspace ?? {} : undefined,
        // The editor saves whatever is on screen; the MCP tools are the strict ones.
        main:
          kind === "blocks"
            ? generated(body.workspace ?? {})
            : String(body.main ?? ""),
      });
      return sendJson(res, 201, project);
    }
  } else if (id) {
    if (req.method === "GET") return sendJson(res, 200, store.get(id));
    if (req.method === "PUT") {
      const body = (await readBody(req)) as Record<string, unknown>;
      let current = store.get(id);
      if (typeof body.name === "string" && body.name.trim() !== current.name) {
        current = store.rename(current.id, body.name);
      }
      const project = store.update(current.id, {
        description:
          typeof body.description === "string" ? body.description : undefined,
        env: body.env as Record<string, string> | undefined,
        workspace: current.kind === "blocks" ? body.workspace : undefined,
        main:
          current.kind === "blocks"
            ? body.workspace !== undefined
              ? generated(body.workspace)
              : undefined
            : typeof body.main === "string"
              ? body.main
              : undefined,
      });
      return sendJson(res, 200, project);
    }
    if (req.method === "DELETE") return sendJson(res, 200, store.remove(id));
  }
  sendJson(res, 405, { error: "Not supported." });
}

export function serveHttp(options: HttpOptions) {
  const library = options.store ? watchLibrary(options.store) : null;
  const anyOrigin = options.allowOrigins.includes("*") && !options.store;
  // With the library (files, code runs), refuse requests not addressed to
  // this machine. Without it, a tunnel (ChatGPT) may forward to it.
  const loopback = LOCAL_HOSTS.has(options.host) && Boolean(options.store);

  const http = createHttpServer(async (req, res) => {
    const origin = req.headers.origin;
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    // Bound to this machine: only answer requests addressed to it.
    if (loopback && !LOCAL_HOSTS.has(host)) {
      res.writeHead(421).end();
      return;
    }
    if (origin) {
      if (anyOrigin) res.setHeader("Access-Control-Allow-Origin", "*");
      else if (options.allowOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      } else {
        // A web page that isn't one of the app's editors.
        sendJson(res, 403, { error: "This origin isn't allowed." });
        return;
      }
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (path === "/" && req.method === "GET") {
      res
        .writeHead(200, { "Content-Type": "text/plain" })
        .end("investec-blockly MCP server. Connect your MCP client to /mcp.\n");
      return;
    }
    if (
      options.store &&
      library &&
      path === "/api/events" &&
      req.method === "GET"
    ) {
      library.subscribe(res);
      return;
    }
    if (options.store && path.startsWith("/api/projects")) {
      try {
        await handleApi(options.store, req, res, path);
      } catch (e) {
        if (e instanceof StoreError)
          sendJson(res, e.status, { error: e.message });
        else {
          console.error(e);
          sendJson(res, 500, { error: (e as Error).message });
        }
      }
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      // Stateless: no server-initiated streams or sessions to delete.
      res
        .writeHead(405, { Allow: "POST", "Content-Type": "application/json" })
        .end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed." },
            id: null,
          }),
        );
      return;
    }
    // A fresh server per request keeps requests independent (stateless mode).
    const server = createServer(options);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    }
  });
  http.listen(options.port, options.host, () => {
    console.error(
      `investec-blockly MCP server on http://${options.host}:${options.port}/mcp${options.store ? ` · card code library ${options.store.root}` : ""}`,
    );
  });
  return http;
}
