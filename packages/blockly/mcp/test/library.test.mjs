// The card code library tools and the editors' API, against a temporary
// library folder. run_card_code is tested only when investec-card-server
// answers at SIMULATOR_URL (default :3010).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const server = fileURLToPath(
  new URL("../dist/investec-blockly-mcp.cjs", import.meta.url),
);
const library = mkdtempSync(join(tmpdir(), "card-code-"));
const client = new Client({ name: "test", version: "1.0.0" });
const port = 4000 + Math.floor(Math.random() * 900);
const origin = "http://127.0.0.1:3002";
const api = `http://127.0.0.1:${port}`;
let http;

before(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server, "--library", library],
      stderr: "ignore",
    }),
  );
  http = spawn(
    process.execPath,
    [
      server,
      "--http",
      String(port),
      "--library",
      library,
      "--allow-origin",
      origin,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  for await (const chunk of http.stderr) {
    if (String(chunk).includes(`:${port}/mcp`)) break;
  }
});
after(async () => {
  await client.close();
  http.kill();
  await once(http, "exit");
  rmSync(library, { recursive: true, force: true });
});

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return {
    text: result.content.map((item) => item.text).join("\n"),
    isError: Boolean(result.isError),
  };
};

const simulatorUp = await fetch(
  process.env.SIMULATOR_URL ?? "http://localhost:3010",
).then(
  (r) => r.ok,
  () => false,
);

test("creates a blocks project from an example, with its env keys", async () => {
  const r = await call("create_card_code", {
    name: "Kill switch",
    kind: "blocks",
    from_example: "remote kill switch",
  });
  assert.equal(r.isError, false, r.text);
  const dir = join(library, "kill-switch");
  assert.ok(existsSync(join(dir, "workspace.json")));
  assert.match(readFileSync(join(dir, "main.js"), "utf8"), /beforeTransaction/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "env.json"), "utf8")), {
    STATUS_URL: "",
  });
});

test("copies a blocks project into JavaScript and edits it", async () => {
  let r = await call("create_card_code", {
    name: "Kill switch JS",
    kind: "code",
    copy_from: "Kill switch",
  });
  assert.equal(r.isError, false, r.text);
  r = await call("edit_main_js", {
    name: "kill-switch-js",
    old_text: "const beforeTransaction",
    new_text: "// edited\nconst beforeTransaction",
  });
  assert.equal(r.isError, false, r.text);
  r = await call("edit_main_js", {
    name: "Kill switch JS",
    old_text: "// edited",
    new_text: "// edited {",
  });
  assert.equal(r.isError, false, "a comment can hold a brace");
  r = await call("edit_main_js", {
    name: "Kill switch JS",
    old_text: "const beforeTransaction",
    new_text: "const beforeTransaction = {",
  });
  assert.equal(r.isError, true);
  assert.match(r.text, /would break main\.js/);
});

test("rejects broken code and wrong kinds", async () => {
  let r = await call("create_card_code", {
    name: "Broken",
    kind: "code",
    main: "const beforeTransaction = async (a) => {",
  });
  assert.equal(r.isError, true);
  r = await call("update_card_code", { name: "Kill switch", main: "x" });
  assert.equal(r.isError, true);
  assert.match(r.text, /generated/);
  r = await call("create_card_code", {
    name: "kill switch",
    kind: "code",
    main: "",
  });
  assert.equal(r.isError, true);
  assert.match(r.text, /already/);
});

test("updates environment variables one at a time", async () => {
  const r = await call("update_card_code", {
    name: "Kill switch",
    set_env: { STATUS_URL: "https://example.com/status.json", EXTRA: "1" },
    remove_env: ["EXTRA"],
  });
  assert.equal(r.isError, false, r.text);
  const env = JSON.parse(
    readFileSync(join(library, "kill-switch", "env.json"), "utf8"),
  );
  assert.deepEqual(env, { STATUS_URL: "https://example.com/status.json" });
});

test("lists, renames, opens and deletes", async () => {
  let r = await call("list_card_code");
  assert.match(r.text, /Kill switch \[blocks\]/);
  assert.match(r.text, /Kill switch JS \[code\]/);
  r = await call("rename_card_code", {
    name: "Kill switch JS",
    new_name: "Lock",
  });
  assert.equal(r.isError, false, r.text);
  assert.ok(existsSync(join(library, "lock", "main.js")));
  r = await call("open_card_code", { name: "lock" });
  assert.equal(r.isError, false);
  assert.equal(
    JSON.parse(readFileSync(join(library, ".open.json"), "utf8")).id,
    "lock",
  );
  r = await call("delete_card_code", { name: "Lock" });
  assert.equal(r.isError, false);
  assert.ok(!existsSync(join(library, "lock")));
  r = await call("get_card_code", { name: "Lock" });
  assert.equal(r.isError, true);
});

test(
  "runs a project on the card server",
  { skip: !simulatorUp && "card server not running" },
  async () => {
    await call("create_card_code", {
      name: "Small spend",
      kind: "code",
      main: "const beforeTransaction = async (a) => { console.log(process.env.LIMIT); return a.centsAmount < Number(process.env.LIMIT); };",
      env: { LIMIT: "5000" },
    });
    const r = await call("run_card_code", {
      name: "Small spend",
      transactions: [{ centsAmount: 1000 }, { centsAmount: 9000 }],
    });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Decision: approved[\s\S]*Decision: declined/);
    assert.match(r.text, /5000/);
  },
);

test("the editors' API lists, saves and streams changes", async () => {
  const headers = { Origin: origin, "Content-Type": "application/json" };
  const list = await fetch(`${api}/api/projects`, { headers }).then((r) =>
    r.json(),
  );
  assert.ok(list.some((p) => p.id === "kill-switch"));

  const controller = new AbortController();
  const events = await fetch(`${api}/api/events`, {
    headers,
    signal: controller.signal,
  });
  const reader = events.body.getReader();
  const created = await fetch(`${api}/api/projects`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "From editor",
      kind: "code",
      main: "// hi\n",
      env: { A: "1" },
    }),
  });
  assert.equal(created.status, 201);
  let seen = "";
  while (!seen.includes("from-editor")) {
    const { value } = await reader.read();
    seen += new TextDecoder().decode(value);
  }
  assert.match(seen, /event: changed/);
  controller.abort();

  const saved = await fetch(`${api}/api/projects/from-editor`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ main: "// changed\n" }),
  }).then((r) => r.json());
  assert.equal(saved.main, "// changed\n");
});

test("refuses other web pages and other host names", async () => {
  const other = await fetch(`${api}/api/projects`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(other.status, 403);
  const mcp = await fetch(`${api}/mcp`, {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(mcp.status, 403);
  // fetch won't set Host, so a raw request: a DNS-rebound page's.
  const status = await new Promise((resolve, reject) =>
    request(
      `${api}/api/projects`,
      { headers: { Host: "attacker.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    )
      .on("error", reject)
      .end(),
  );
  assert.equal(status, 421);
});
