// The card code library: projects on disk that the desktop app's two editors
// (Card blocks and Card code) and the MCP server all read and write.
//
//   <root>/<id>/card-code.json   { name, kind, description, createdAt, updatedAt }
//   <root>/<id>/main.js          the card code (generated, for blocks projects)
//   <root>/<id>/env.json         its environment variables
//   <root>/<id>/workspace.json   the Blockly workspace (blocks projects only)
//   <root>/.trash/               deleted projects, kept until removed by hand
//   <root>/.open.json            "show this project", for the app to pick up
//
// Plain files, so they can be read, edited or backed up outside the app too.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProjectKind = "blocks" | "code";

export type ProjectSummary = {
  id: string;
  name: string;
  kind: ProjectKind;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** Names in env.json. */
  envKeys: string[];
};

export type Project = ProjectSummary & {
  main: string;
  env: Record<string, string>;
  /** Blocks projects only. */
  workspace?: unknown;
};

export type ProjectInput = {
  name: string;
  kind: ProjectKind;
  description?: string;
  main?: string;
  env?: Record<string, string>;
  workspace?: unknown;
};

export type ProjectPatch = {
  description?: string;
  main?: string;
  env?: Record<string, string>;
  workspace?: unknown;
};

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const META = "card-code.json";
export const OPEN_FILE = ".open.json";

/** Where the desktop app keeps the library, unless CARD_CODE_DIR says otherwise. */
export function defaultStoreDir(): string {
  if (process.env.CARD_CODE_DIR) return process.env.CARD_CODE_DIR;
  const home = homedir();
  const appData =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? process.env.APPDATA ?? join(home, "AppData", "Roaming")
        : process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(appData, "Investec Sandbox", "card-code");
}

/** A folder name for a project name: lower-case words joined by hyphens. */
export const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new StoreError("A project needs a name.");
  if (trimmed.length > 80)
    throw new StoreError("Keep the name under 80 characters.");
  if (!slug(trimmed))
    throw new StoreError("Use some letters or numbers in the name.");
  return trimmed;
}

function cleanEnv(env: unknown): Record<string, string> {
  if (env === undefined || env === null) return {};
  if (typeof env !== "object" || Array.isArray(env)) {
    throw new StoreError('env should be an object, like { "NAME": "value" }.');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new StoreError(
        `"${key}" isn't a usable variable name (letters, digits and _).`,
      );
    }
    if (value !== null && typeof value === "object") {
      throw new StoreError(`${key} should be text.`);
    }
    out[key] = value === null || value === undefined ? "" : String(value);
  }
  return out;
}

export class CardCodeStore {
  constructor(readonly root: string = defaultStoreDir()) {}

  private dir(id: string) {
    return join(this.root, id);
  }

  private ensureRoot() {
    mkdirSync(this.root, { recursive: true });
  }

  private readMeta(id: string): Omit<ProjectSummary, "envKeys" | "id"> | null {
    try {
      const meta = JSON.parse(readFileSync(join(this.dir(id), META), "utf8"));
      if (!meta || (meta.kind !== "blocks" && meta.kind !== "code"))
        return null;
      return {
        name: String(meta.name ?? id),
        kind: meta.kind,
        description: String(meta.description ?? ""),
        createdAt: String(meta.createdAt ?? ""),
        updatedAt: String(meta.updatedAt ?? ""),
      };
    } catch {
      return null;
    }
  }

  private readText(id: string, file: string, fallback = "") {
    try {
      return readFileSync(join(this.dir(id), file), "utf8");
    } catch {
      return fallback;
    }
  }

  private readEnv(id: string): Record<string, string> {
    try {
      return cleanEnv(JSON.parse(this.readText(id, "env.json", "{}") || "{}"));
    } catch {
      return {};
    }
  }

  list(): ProjectSummary[] {
    if (!existsSync(this.root)) return [];
    const out: ProjectSummary[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const meta = this.readMeta(entry.name);
      if (meta)
        out.push({
          id: entry.name,
          ...meta,
          envKeys: Object.keys(this.readEnv(entry.name)),
        });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** A project's id from its id or name (any case). */
  resolve(nameOrId: string): string {
    const wanted = nameOrId.trim();
    const all = this.list();
    const match =
      all.find((p) => p.id === wanted) ??
      all.find((p) => p.name.toLowerCase() === wanted.toLowerCase()) ??
      all.find((p) => p.id === slug(wanted));
    if (!match) {
      throw new StoreError(
        `No card code project called "${nameOrId}".${all.length ? ` Projects: ${all.map((p) => p.name).join(", ")}` : " There are none yet."}`,
        404,
      );
    }
    return match.id;
  }

  get(nameOrId: string): Project {
    const id = this.resolve(nameOrId);
    const meta = this.readMeta(id)!;
    const env = this.readEnv(id);
    const project: Project = {
      id,
      ...meta,
      envKeys: Object.keys(env),
      main: this.readText(id, "main.js"),
      env,
    };
    if (meta.kind === "blocks") {
      try {
        project.workspace = JSON.parse(
          this.readText(id, "workspace.json", "{}"),
        );
      } catch {
        project.workspace = {};
      }
    }
    return project;
  }

  private write(id: string, file: string, text: string) {
    writeFileSync(join(this.dir(id), file), text);
  }

  private writeMeta(id: string, meta: Omit<ProjectSummary, "envKeys" | "id">) {
    this.write(id, META, JSON.stringify(meta, null, 2) + "\n");
  }

  create(input: ProjectInput): Project {
    const name = cleanName(input.name);
    if (input.kind !== "blocks" && input.kind !== "code") {
      throw new StoreError(
        'kind is "blocks" (Blockly) or "code" (JavaScript).',
      );
    }
    const id = slug(name);
    if (
      this.list().some(
        (p) => p.id === id || p.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new StoreError(`There's already a project called "${name}".`, 409);
    }
    const env = cleanEnv(input.env);
    this.ensureRoot();
    mkdirSync(this.dir(id), { recursive: true });
    const now = new Date().toISOString();
    this.write(id, "main.js", input.main ?? "");
    this.write(id, "env.json", JSON.stringify(env, null, 2) + "\n");
    if (input.kind === "blocks") {
      this.write(
        id,
        "workspace.json",
        JSON.stringify(input.workspace ?? {}, null, 2) + "\n",
      );
    }
    this.writeMeta(id, {
      name,
      kind: input.kind,
      description: input.description?.trim() ?? "",
      createdAt: now,
      updatedAt: now,
    });
    return this.get(id);
  }

  update(nameOrId: string, patch: ProjectPatch): Project {
    const id = this.resolve(nameOrId);
    const meta = this.readMeta(id)!;
    if (patch.workspace !== undefined && meta.kind !== "blocks") {
      throw new StoreError(
        `"${meta.name}" is a JavaScript project; change its main.js instead.`,
      );
    }
    if (patch.env !== undefined) {
      this.write(
        id,
        "env.json",
        JSON.stringify(cleanEnv(patch.env), null, 2) + "\n",
      );
    }
    if (patch.main !== undefined) this.write(id, "main.js", patch.main);
    if (patch.workspace !== undefined) {
      this.write(
        id,
        "workspace.json",
        JSON.stringify(patch.workspace, null, 2) + "\n",
      );
    }
    this.writeMeta(id, {
      ...meta,
      description:
        patch.description !== undefined
          ? patch.description.trim()
          : meta.description,
      updatedAt: new Date().toISOString(),
    });
    return this.get(id);
  }

  rename(nameOrId: string, newName: string): Project {
    const id = this.resolve(nameOrId);
    const name = cleanName(newName);
    const newId = slug(name);
    const clash = this.list().find(
      (p) =>
        p.id !== id &&
        (p.id === newId || p.name.toLowerCase() === name.toLowerCase()),
    );
    if (clash)
      throw new StoreError(
        `There's already a project called "${clash.name}".`,
        409,
      );
    if (newId !== id) renameSync(this.dir(id), this.dir(newId));
    const meta = this.readMeta(newId)!;
    this.writeMeta(newId, {
      ...meta,
      name,
      updatedAt: new Date().toISOString(),
    });
    return this.get(newId);
  }

  /** Moves the project to .trash, so it can be recovered by hand. */
  remove(nameOrId: string): { id: string; name: string; trashedTo: string } {
    const id = this.resolve(nameOrId);
    const meta = this.readMeta(id)!;
    const trash = join(this.root, ".trash");
    mkdirSync(trash, { recursive: true });
    const target = join(
      trash,
      `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    renameSync(this.dir(id), target);
    return { id, name: meta.name, trashedTo: target };
  }

  /** Asks the desktop app to show the project in its editor. */
  requestOpen(nameOrId: string): Project {
    const project = this.get(nameOrId);
    this.ensureRoot();
    writeFileSync(
      join(this.root, OPEN_FILE),
      JSON.stringify({ id: project.id, kind: project.kind, at: Date.now() }) +
        "\n",
    );
    return project;
  }

  readOpenRequest(): { id: string; kind: ProjectKind; at: number } | null {
    try {
      return JSON.parse(readFileSync(join(this.root, OPEN_FILE), "utf8"));
    } catch {
      return null;
    }
  }
}
