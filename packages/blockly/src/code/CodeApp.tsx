import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  BookmarkIcon,
  CodeBracketIcon,
  PlayIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
} from "@heroicons/react/20/solid";

import { GuideView } from "../components/GuideView";
import { NameDialog } from "../components/NameDialog";
import { ResizeHandle } from "../components/ResizeHandle";
import { ResultsView } from "../components/ResultsView";
import { SidePanel, type PanelTab } from "../components/SidePanel";
import { Toasts } from "../components/Toasts";
import { TransactionForm } from "../components/TransactionForm";
import type { EnvironmentRow } from "../components/EnvironmentEditor";
import { usePrefersDark } from "../hooks/usePrefersDark";
import { useResizable } from "../hooks/useResizable";
import { useToasts } from "../hooks/useToasts";
import { examples, type Scenario } from "../examples";
import { inApp } from "../lib/appMode";
import { confirmAction, saveTextFile } from "../lib/desktop";
import {
  defaultTransaction,
  simulate,
  validateTransaction,
  type ExecutionItem,
  type TransactionInput,
} from "../lib/simulator";
import { STORAGE_PREFIX, readStorage, writeStorage } from "../lib/storage";
import {
  createProject,
  getProject,
  hasLibrary,
  saveProject,
  watchProjectList,
  watchProjects,
  type Project,
  type ProjectSummary,
} from "../lib/library";
import { MonacoEditor, type CodeFile, type MonacoHandle } from "./MonacoEditor";
import { BLANK_MAIN, parseEnv } from "./files";

const exampleNames = Object.keys(examples);
const DEFAULT_EXAMPLE = "Petrol Card";
const SAVE_DELAY_MS = 300;
const FILES: CodeFile[] = ["main.js", "env.json"];
const KEY = {
  file: (file: CodeFile) => `${STORAGE_PREFIX}code:${file}`,
  source: `${STORAGE_PREFIX}code:source`,
  active: `${STORAGE_PREFIX}code:activeFile`,
  panel: `${STORAGE_PREFIX}code:panelVisible`,
  project: `${STORAGE_PREFIX}code:project`,
};
const LIBRARY_SAVE_DELAY_MS = 600;

type OpenProject = { id: string; name: string };

function storedProject(): OpenProject | null {
  if (!hasLibrary()) return null;
  try {
    const value = JSON.parse(readStorage(KEY.project) ?? "null");
    return value?.id
      ? { id: String(value.id), name: String(value.name) }
      : null;
  } catch {
    return null;
  }
}

const envText = (env: Record<string, string>) =>
  JSON.stringify(env, null, 2) + "\n";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iP(hone|ad)/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";
const iconClass = "size-4 shrink-0";

// Example code comes from the Blockly workspaces, so Blockly loads only
// when one is opened.
const loadExampleCode = (name: string) =>
  import("./exampleCode").then((m) => m.exampleCode(name));

function ToolButton({
  label,
  icon,
  onClick,
  pressed,
  shortcut,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      aria-pressed={pressed}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${
        pressed
          ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
          : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
      }`}
    >
      {icon}
      <span className="sr-only lg:not-sr-only">{label}</span>
    </button>
  );
}

const storedFile = (file: CodeFile) => readStorage(KEY.file(file));

export default function CodeApp() {
  const prefersDark = usePrefersDark();
  const { toasts, notify, dismiss } = useToasts();
  const editor = useRef<MonacoHandle | null>(null);
  const saveTimers = useRef(new Map<CodeFile, number>());
  const fileInput = useRef<HTMLInputElement>(null);

  // Both files live in the editor's models; these mirror them for Run and
  // the guide, and are what the autosave writes.
  const [initial] = useState<Record<CodeFile, string>>(() => ({
    "main.js": storedFile("main.js") ?? "",
    "env.json": storedFile("env.json") ?? "{}\n",
  }));
  const [texts, setTexts] = useState(initial);
  const [file, setFile] = useState<CodeFile>(() =>
    readStorage(KEY.active) === "env.json" ? "env.json" : "main.js",
  );
  const [source, setSource] = useState(() => readStorage(KEY.source) ?? "");
  // The library project being edited (desktop app only): edits save to it,
  // and changes made to it elsewhere (an AI assistant) show up here.
  const [project, setProjectState] = useState<OpenProject | null>(
    storedProject,
  );
  const projectRef = useRef(project);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  // What the library holds, as last loaded or saved, to tell our own saves
  // from someone else's.
  const synced = useRef<{ main: string; env: string } | null>(null);
  const libraryTimer = useRef<number | undefined>(undefined);
  // main.js as last opened or imported: no need to confirm replacing it.
  const pristine = useRef(initial["main.js"]);
  const [tab, setTab] = useState<PanelTab>("transaction");
  const [transaction, setTransaction] =
    useState<TransactionInput>(defaultTransaction);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<ExecutionItem[] | null>(null);
  const [outputFor, setOutputFor] = useState<TransactionInput | null>(null);
  const [panelVisible, setPanelVisible] = useState(
    () => readStorage(KEY.panel) !== "false",
  );
  const panel = useResizable({
    storageKey: STORAGE_PREFIX + "code:panelWidth",
    initial: 380,
    min: 300,
    max: () => window.innerWidth * 0.6,
    axis: "x",
    direction: -1,
  });

  const env = parseEnv(texts["env.json"]);
  const envRows: EnvironmentRow[] =
    "values" in env
      ? Object.entries(env.values).map(([name, value]) => ({ name, value }))
      : [];
  const example = examples[source];
  const guide = example?.guide;
  const activeTab: PanelTab = tab === "guide" && !guide ? "transaction" : tab;

  useEffect(() => {
    writeStorage(KEY.active, file);
  }, [file]);
  useEffect(() => {
    writeStorage(KEY.source, source);
  }, [source]);

  function setProject(next: OpenProject | null) {
    projectRef.current = next;
    setProjectState(next);
    writeStorage(KEY.project, next ? JSON.stringify(next) : "");
    window.clearTimeout(libraryTimer.current);
    if (!next) synced.current = null;
  }

  /** Puts a library project's files in the editor. */
  function showProject(loaded: Project) {
    const env = envText(loaded.env);
    synced.current = { main: loaded.main, env: JSON.stringify(loaded.env) };
    setProject({ id: loaded.id, name: loaded.name });
    setFileText("main.js", loaded.main);
    setFileText("env.json", env);
    pristine.current = loaded.main;
    setSource("");
  }

  /** Saves the editor's files to the open project, shortly after edits. */
  function scheduleLibrarySave() {
    const open = projectRef.current;
    if (!open) return;
    window.clearTimeout(libraryTimer.current);
    libraryTimer.current = window.setTimeout(async () => {
      const main = editor.current?.getValue("main.js") ?? "";
      const parsed = parseEnv(editor.current?.getValue("env.json") ?? "{}");
      // A half-typed env.json waits until it parses again.
      const env = "values" in parsed ? parsed.values : undefined;
      const last = synced.current;
      const envJson = env ? JSON.stringify(env) : last?.env;
      if (last && last.main === main && last.env === envJson) return;
      try {
        await saveProject(open.id, { main, ...(env ? { env } : {}) });
        if (projectRef.current?.id === open.id) {
          synced.current = { main, env: envJson ?? "{}" };
        }
      } catch (e) {
        notify(
          `Couldn't save "${open.name}": ${(e as Error).message}`,
          "error",
        );
      }
    }, LIBRARY_SAVE_DELAY_MS);
  }

  // The project list for the Open menu, and changes to the open project.
  useEffect(() => watchProjectList(setProjects), []);
  const onLibraryChange = useEffectEvent(async (ids: string[]) => {
    const open = projectRef.current;
    if (!open || !ids.includes(open.id)) return;
    let loaded: Project;
    try {
      loaded = await getProject(open.id);
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        notify(
          `"${open.name}" was deleted or renamed in the library. Save as a project to keep it.`,
          "info",
        );
        setProject(null);
      }
      return;
    }
    const last = synced.current;
    const envJson = JSON.stringify(loaded.env);
    if (last && last.main === loaded.main && last.env === envJson) return;
    synced.current = { main: loaded.main, env: envJson };
    if ((editor.current?.getValue("main.js") ?? "") !== loaded.main) {
      setFileText("main.js", loaded.main);
    }
    const currentEnv = parseEnv(editor.current?.getValue("env.json") ?? "");
    if (
      !("values" in currentEnv) ||
      JSON.stringify(currentEnv.values) !== envJson
    ) {
      setFileText("env.json", envText(loaded.env));
    }
    pristine.current = loaded.main;
    notify(`"${loaded.name}" was updated in the library.`, "info");
  });
  useEffect(() => watchProjects((ids) => void onLibraryChange(ids)), []);
  // Pick up changes made while the page was away.
  useEffect(() => {
    const open = projectRef.current;
    if (open) void onLibraryChange([open.id]);
  }, []);

  async function openProject(id: string) {
    try {
      const loaded = await getProject(id);
      if (loaded.kind === "blocks") {
        // A copy of its generated code; Save as project keeps it.
        setProject(null);
        setFileText("main.js", loaded.main);
        setFileText("env.json", envText(loaded.env));
        pristine.current = loaded.main;
        setSource("");
        notify(
          `Copied the code of "${loaded.name}". Save it as a project to keep it.`,
          "info",
        );
      } else {
        showProject(loaded);
        notify(`Opened "${loaded.name}".`);
      }
      setFile("main.js");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }

  async function saveAsProject(name: string) {
    const parsed = parseEnv(editor.current?.getValue("env.json") ?? "{}");
    if (!("values" in parsed)) {
      setFile("env.json");
      notify(`Fix env.json first: ${parsed.error}`, "error");
      return;
    }
    try {
      const created = await createProject({
        name,
        kind: "code",
        main: editor.current?.getValue("main.js") ?? "",
        env: parsed.values,
      });
      synced.current = { main: created.main, env: JSON.stringify(created.env) };
      setProject({ id: created.id, name: created.name });
      pristine.current = created.main;
      setSaveAsOpen(false);
      notify(`Saved "${created.name}" in the card code library.`);
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }

  function save(name: CodeFile, text: string) {
    window.clearTimeout(saveTimers.current.get(name));
    saveTimers.current.set(
      name,
      window.setTimeout(
        () => writeStorage(KEY.file(name), text),
        SAVE_DELAY_MS,
      ),
    );
  }
  // Don't lose the last keystrokes when the page goes away.
  useEffect(() => {
    const flush = () => {
      for (const name of FILES) {
        const text = editor.current?.getValue(name);
        if (text !== undefined) writeStorage(KEY.file(name), text);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  function onChange(name: CodeFile, text: string) {
    setTexts((current) => ({ ...current, [name]: text }));
    save(name, text);
    scheduleLibrarySave();
  }

  function setFileText(name: CodeFile, text: string) {
    // Through the editor, so it's one undoable edit and onChange follows.
    if (editor.current) editor.current.setValue(name, text);
    else onChange(name, text);
  }

  /** Adds the variables an example reads to env.json, keeping set values. */
  function addEnvKeys(names: string[], values: Record<string, string> = {}) {
    if (!names.length && !Object.keys(values).length) return true;
    const parsed = parseEnv(editor.current?.getValue("env.json") ?? "{}");
    if (!("values" in parsed)) return false;
    const next = { ...parsed.values };
    for (const name of names) next[name] ??= "";
    Object.assign(next, values);
    setFileText("env.json", JSON.stringify(next, null, 2) + "\n");
    return next;
  }

  const confirmReplace = async () => {
    const current = editor.current?.getValue("main.js") ?? "";
    return (
      !current.trim() ||
      current === pristine.current ||
      confirmAction({
        message: "Replace main.js?",
        detail: "Export it first if you want to keep it.",
        confirmLabel: "Replace",
        destructive: true,
      })
    );
  };

  async function open(next: string, { ask = true } = {}) {
    if (next.startsWith("project:")) {
      const id = next.slice("project:".length);
      if (id === projectRef.current?.id) return;
      if (ask && !projectRef.current && !(await confirmReplace())) return;
      await openProject(id);
      return;
    }
    // Leaving a project: it's saved already, so no need to ask.
    if (ask && !projectRef.current && !(await confirmReplace())) return;
    setProject(null);
    if (next === "new") {
      setFileText("main.js", BLANK_MAIN);
      pristine.current = BLANK_MAIN;
      setSource("");
      setFile("main.js");
      return;
    }
    try {
      const code = await loadExampleCode(next);
      setFileText("main.js", code);
      pristine.current = code;
      setSource(next);
      setFile("main.js");
      const opened = examples[next];
      if (opened?.guide) setTab("guide");
      const needed = opened?.env ?? [];
      const merged = addEnvKeys(needed);
      if (!merged) {
        notify(
          `Opened "${next}". Fix env.json, then add ${needed.join(", ")}.`,
          "info",
        );
        return;
      }
      const unset = needed.filter((name) => merged !== true && !merged[name]);
      if (ask) {
        notify(
          unset.length
            ? `Opened "${next}". Set ${unset.join(", ")} in env.json.`
            : `Opened "${next}".`,
          unset.length ? "info" : "success",
        );
      }
    } catch (e) {
      notify(`"${next}" could not be opened: ${(e as Error).message}`, "error");
    }
  }

  // First visit: start with an example and its write-up.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || initial["main.js"].trim() || projectRef.current)
      return;
    started.current = true;
    void open(DEFAULT_EXAMPLE, { ask: false });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importFiles(list: FileList | File[]) {
    for (const picked of Array.from(list)) {
      const text = await picked.text();
      if (/\.json$/i.test(picked.name)) {
        const parsed = parseEnv(text);
        if (!("values" in parsed)) {
          notify(`${picked.name}: ${parsed.error}`, "error");
          continue;
        }
        setFileText("env.json", text);
        setFile("env.json");
        notify(`Imported ${picked.name} as env.json.`);
      } else {
        if (!(await confirmReplace())) continue;
        setFileText("main.js", text);
        pristine.current = text;
        setSource("");
        setFile("main.js");
        notify(`Imported ${picked.name} as main.js.`);
      }
    }
  }

  async function exportFile(name: CodeFile = file) {
    const text = editor.current?.getValue(name) ?? texts[name];
    const saved = await saveTextFile(name, text);
    if (saved && window.sandboxApp) notify(`Exported to ${saved}.`);
  }

  function showPanel(visible: boolean) {
    setPanelVisible(visible);
    writeStorage(KEY.panel, String(visible));
  }

  async function run(
    input: TransactionInput = transaction,
    envValues?: Record<string, string>,
  ) {
    if (running) return;
    const code = editor.current?.getValue("main.js") ?? texts["main.js"];
    if (!code.trim()) {
      notify("main.js is empty.", "error");
      return;
    }
    let values = envValues;
    if (!values) {
      const parsed = parseEnv(editor.current?.getValue("env.json") ?? "{}");
      if (!("values" in parsed)) {
        setFile("env.json");
        notify(`env.json: ${parsed.error}`, "error");
        return;
      }
      values = parsed.values;
    }
    const invalid = validateTransaction(input);
    if (invalid) {
      setTab("transaction");
      showPanel(true);
      notify(invalid, "error");
      return;
    }
    const cleaned = {
      ...input,
      merchantName: input.merchantName.trim(),
      merchantCity: input.merchantCity.trim(),
    };
    setRunning(true);
    setError("");
    try {
      setOutput(await simulate(code, cleaned, values));
      setOutputFor(cleaned);
    } catch (e) {
      setOutput(null);
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setTab("results");
      showPanel(true);
    }
  }

  function runScenario(scenario: Scenario) {
    const next = { ...defaultTransaction, ...scenario.transaction };
    setTransaction(next);
    const merged = addEnvKeys([], scenario.env ?? {});
    if (!merged) {
      setFile("env.json");
      notify("Fix env.json first: it isn’t a JSON object.", "error");
      return;
    }
    void run(next, merged === true ? undefined : merged);
  }

  // ⌘↵ runs (the editor handles it while focused), ⌘J shows the panel.
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.shiftKey) {
      if (key === "s" && hasLibrary()) {
        event.preventDefault();
        setSaveAsOpen(true);
      }
      return;
    }
    if (key === "enter") {
      event.preventDefault();
      void run();
    } else if (key === "j") {
      event.preventDefault();
      showPanel(!panelVisible);
    } else if (key === "s") {
      // Everything autosaves; ⌘S exports the open file.
      event.preventDefault();
      void exportFile();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // The desktop app's Card Code menu.
  const onMenuAction = useEffectEvent((action: string) => {
    if (action === "run") void run();
    else if (action === "export") void exportFile();
    else if (action === "save-as") {
      if (hasLibrary()) setSaveAsOpen(true);
      else void exportFile();
    } else if (action.startsWith("open-project:")) {
      void openProject(action.slice("open-project:".length));
    } else if (action === "import") fileInput.current?.click();
    else if (action === "toggle-panel") showPanel(!panelVisible);
  });
  useEffect(
    () => window.sandboxApp?.onAction((action) => onMenuAction(action)),
    [],
  );

  const approved = output?.find(
    (item) => item.type === "before_transaction",
  )?.authorizationApproved;
  const resultsBadge =
    activeTab === "results" ? null : output ? (
      <span
        className={`size-2 rounded-full ${approved ? "bg-emerald-500" : "bg-red-500"}`}
        aria-label={approved ? "approved" : "declined"}
      />
    ) : error ? (
      <span className="size-2 rounded-full bg-red-500" aria-label="error" />
    ) : null;

  const envNote = (
    <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-inset ring-gray-200 dark:bg-gray-800/50 dark:text-gray-300 dark:ring-gray-700">
      <p className="font-medium text-gray-900 dark:text-white">
        Environment variables
      </p>
      {"values" in env ? (
        <p className="mt-1">
          {envRows.length
            ? `${envRows.length} from env.json: ${envRows.map((r) => r.name).join(", ")}.`
            : "None yet."}{" "}
          <button
            type="button"
            onClick={() => setFile("env.json")}
            className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            Edit env.json
          </button>
        </p>
      ) : (
        <p className="mt-1 text-red-600 dark:text-red-400">
          env.json: {env.error}
        </p>
      )}
    </div>
  );

  return (
    <div
      className={`flex flex-col ${inApp ? "h-dvh overflow-hidden" : "h-dvh"} ${
        panel.dragging ? "cursor-col-resize select-none" : ""
      }`}
    >
      <header className="flex select-none items-center gap-x-3 border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        {!inApp && (
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white">
              <CodeBracketIcon className="size-5" aria-hidden />
            </span>
            <h1 className="hidden text-base font-semibold text-gray-900 sm:block dark:text-white">
              Card Code Editor
            </h1>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
          <label htmlFor="code-source" className="sr-only">
            Open an example
          </label>
          <select
            id="code-source"
            value={
              project ? `project:${project.id}` : examples[source] ? source : ""
            }
            onChange={(event) => void open(event.target.value)}
            className="mr-1 min-w-0 flex-1 rounded-md border-0 bg-white py-1.5 pl-3 pr-9 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600 sm:flex-none dark:bg-gray-800 dark:text-gray-100 dark:ring-gray-700"
          >
            <option value="" disabled>
              Open…
            </option>
            <option value="new">New main.js</option>
            {project && !projects.some((p) => p.id === project.id) && (
              <option value={`project:${project.id}`}>{project.name}</option>
            )}
            {projects.some((p) => p.kind === "code") && (
              <optgroup label="Projects">
                {projects
                  .filter((p) => p.kind === "code")
                  .map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            )}
            {projects.some((p) => p.kind === "blocks") && (
              <optgroup label="Copy code from a blocks project">
                {projects
                  .filter((p) => p.kind === "blocks")
                  .map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            )}
            <optgroup label="Examples">
              {exampleNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </optgroup>
          </select>
          {hasLibrary() && (
            <ToolButton
              label={project ? "Save as…" : "Save as project…"}
              icon={<BookmarkIcon className={iconClass} aria-hidden />}
              onClick={() => setSaveAsOpen(true)}
              shortcut={`${isMac ? "⇧⌘" : "Ctrl+Shift+"}S`}
            />
          )}
          <ToolButton
            label="Import"
            icon={<ArrowUpTrayIcon className={iconClass} aria-hidden />}
            onClick={() => fileInput.current?.click()}
          />
          <ToolButton
            label={`Export ${file}`}
            icon={<ArrowDownTrayIcon className={iconClass} aria-hidden />}
            onClick={() => void exportFile()}
            shortcut={`${mod}S`}
          />
          {!inApp && (
            <a
              href="./"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Squares2X2Icon className={iconClass} aria-hidden />
              <span className="sr-only lg:not-sr-only">Blocks editor</span>
            </a>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".js,.mjs,.cjs,.json,text/javascript,application/json"
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (files?.length) void importFiles(files);
              event.target.value = "";
            }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ToolButton
            label="Panel"
            icon={<ViewColumnsIcon className={iconClass} aria-hidden />}
            onClick={() => showPanel(!panelVisible)}
            pressed={panelVisible}
            shortcut={`${mod}J`}
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayIcon className={iconClass} aria-hidden />
            {running ? "Running…" : "Run"}
            <kbd className="hidden rounded bg-indigo-500/60 px-1.5 font-sans text-xs sm:inline">
              {isMac ? "⌘" : "Ctrl"} ↵
            </kbd>
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-row">
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-gray-900"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (event.dataTransfer.files.length) {
              void importFiles(event.dataTransfer.files);
            }
          }}
        >
          <div
            role="tablist"
            aria-label="Files"
            className="flex shrink-0 select-none border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950"
          >
            {FILES.map((name) => {
              const selected = name === file;
              const broken = name === "env.json" && "error" in env;
              return (
                <button
                  key={name}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  onClick={() => setFile(name)}
                  title={broken ? `env.json: ${env.error}` : name}
                  className={`-mb-px inline-flex items-center gap-2 border-r border-gray-200 px-4 py-2 font-mono text-[13px] dark:border-gray-800 ${
                    selected
                      ? "border-b border-b-white bg-white text-gray-900 dark:border-b-gray-900 dark:bg-gray-900 dark:text-white"
                      : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  <span
                    className={`size-2 rounded-sm ${name === "main.js" ? "bg-amber-400" : "bg-sky-400"}`}
                    aria-hidden
                  />
                  {name}
                  {broken && (
                    <span
                      className="size-2 rounded-full bg-red-500"
                      aria-label="has an error"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <MonacoEditor
            className="min-h-0 flex-1"
            file={file}
            initial={initial}
            dark={prefersDark}
            onChange={onChange}
            onRun={() => void run()}
            onReady={(handle) => (editor.current = handle)}
          />
        </section>
        {panelVisible && (
          <ResizeHandle
            resizable={panel}
            label="Resize side panel"
            className="flex border-l border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
          />
        )}
        <SidePanel
          tab={activeTab}
          onTabChange={setTab}
          resultsBadge={resultsBadge}
          showGuide={Boolean(guide)}
          showCode={false}
          hidden={!panelVisible}
          className="w-[var(--panel-width)] shrink-0"
          style={{ "--panel-width": `${panel.size}px` } as CSSProperties}
        >
          {activeTab === "guide" && guide && (
            <GuideView
              mode="code"
              name={source}
              guide={guide}
              envNames={example?.env ?? []}
              environment={envRows}
              running={running}
              onRunScenario={runScenario}
              onShowEnvironment={() => setFile("env.json")}
            />
          )}
          {activeTab === "transaction" && (
            <TransactionForm
              subject="main.js"
              transaction={transaction}
              onTransactionChange={setTransaction}
              environmentNote={envNote}
              running={running}
              onRun={() => void run()}
            />
          )}
          {activeTab === "results" && (
            <ResultsView items={output} transaction={outputFor} error={error} />
          )}
        </SidePanel>
      </main>
      <NameDialog
        open={saveAsOpen}
        title="Save as a project"
        label="Name"
        initial={
          project ? `${project.name} copy` : examples[source] ? source : ""
        }
        confirmLabel="Save"
        onSubmit={(name) => void saveAsProject(name)}
        onClose={() => setSaveAsOpen(false)}
      />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
