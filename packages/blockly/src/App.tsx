import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as Blockly from "blockly/core";
import {
  javascriptGenerator,
  type JavascriptGenerator,
} from "blockly/javascript";

import { BlocklyWorkspace } from "./components/BlocklyWorkspace";
import { AboutDialog } from "./components/AboutDialog";
import { CodeView } from "./components/CodeView";
import { Footer } from "./components/Footer";
import { GuideView } from "./components/GuideView";
import type { EnvironmentRow } from "./components/EnvironmentEditor";
import { Header, type WorkspaceSource } from "./components/Header";
import { NameDialog } from "./components/NameDialog";
import { ResizeHandle } from "./components/ResizeHandle";
import { ResultsView } from "./components/ResultsView";
import { SidePanel, type PanelTab } from "./components/SidePanel";
import { Toasts } from "./components/Toasts";
import { TransactionForm } from "./components/TransactionForm";
import { darkTheme, lightTheme } from "./blockly/themes";
import { usePrefersDark } from "./hooks/usePrefersDark";
import { useResizable } from "./hooks/useResizable";
import { useToasts } from "./hooks/useToasts";
import { installBlocks } from "./blocks";
import { examples, type Scenario } from "./examples";
import {
  defaultTransaction,
  simulate,
  validateTransaction,
  type ExecutionItem,
  type TransactionInput,
} from "./lib/simulator";
import { inApp } from "./lib/appMode";
import { confirmAction } from "./lib/desktop";
import { generateRunnableCode } from "./lib/codegen";
import { readShareHash, decodeWorkspace, shareUrl } from "./lib/share";
import { STORAGE_PREFIX, readStorage, writeStorage } from "./lib/storage";
import {
  createProject,
  getProject,
  hasLibrary,
  saveProject,
  watchProjectList,
  watchProjects,
  type Project,
  type ProjectSummary,
} from "./lib/library";
import {
  downloadWorkspace,
  listSaved,
  readAutosave,
  readSaved,
  readWorkspaceFile,
  writeAutosave,
  writeSaved,
  type WorkspaceState,
} from "./lib/workspaces";
import {
  InvestecToolbox,
  TemplatesToolbox,
  HttpToolbox,
  DateTimeToolbox,
  LogicToolbox,
  LoopsToolbox,
  MathToolbox,
  TextToolbox,
  ListsToolbox,
  VariablesToolbox,
  FunctionsToolbox,
} from "./toolbox";

// TODO: upload code to a card via the API.

// Blockly 10 types javascriptGenerator as `any`; the class type is exported.
const generator = javascriptGenerator as JavascriptGenerator;
installBlocks({ javascript: generator });

const exampleNames = Object.keys(examples);
const DEFAULT_EXAMPLE = "Petrol Card";
const AUTOSAVE_DELAY_MS = 500;
const TOOLBOX_KEY = STORAGE_PREFIX + "toolboxVisible";
const PANEL_KEY = STORAGE_PREFIX + "panelVisible";
// Which example or saved workspace the autosave came from, for its guide.
const SOURCE_KEY = STORAGE_PREFIX + "autosaveSource";
// Set once the About dialog has been seen, so it only opens by itself once.
const ABOUT_SEEN_KEY = STORAGE_PREFIX + "aboutSeen";

/** Remembered choice, else shown except on phone-sized screens. */
function initialToolboxVisible(): boolean {
  const stored = readStorage(TOOLBOX_KEY);
  return stored === null ? window.innerWidth >= 768 : stored === "true";
}

/** Shows or hides the block toolbox and lets the workspace take the space. */
function applyToolboxVisible(
  workspace: Blockly.WorkspaceSvg,
  visible: boolean,
) {
  workspace.getToolbox()?.setVisible(visible);
  Blockly.svgResize(workspace);
}

const options: Blockly.BlocklyOptions = {
  media: "media/",
  // Each handler can only be defined once (it becomes a const in the code).
  maxInstances: {
    investec_card_before_transaction: 1,
    investec_card_after_transaction: 1,
    investec_card_after_decline: 1,
  },
  // A neutral grid that reads on both the light and dark backgrounds.
  grid: {
    spacing: 25,
    length: 3,
    colour: "rgba(156, 163, 175, 0.45)",
    snap: true,
  },
  zoom: { controls: true, wheel: false, startScale: 0.9 },
  trashcan: true,
  toolbox: {
    kind: "categoryToolbox",
    contents: [
      InvestecToolbox,
      TemplatesToolbox,
      HttpToolbox,
      DateTimeToolbox,
      LogicToolbox,
      LoopsToolbox,
      MathToolbox,
      TextToolbox,
      ListsToolbox,
      VariablesToolbox,
      FunctionsToolbox,
    ],
  },
};

const generateCode = (workspace: Blockly.Workspace) =>
  generateRunnableCode(generator, workspace);

const sourceName = (source: WorkspaceSource | "") =>
  source ? source.slice(source.indexOf(":") + 1) : "";
const projectId = (source: WorkspaceSource | "") =>
  source.startsWith("project:") ? source.slice("project:".length) : null;
const LIBRARY_SAVE_DELAY_MS = 600;
const envObject = (rows: EnvironmentRow[]) =>
  Object.fromEntries(
    rows.filter((row) => row.name).map((row) => [row.name, row.value]),
  );

export default function App() {
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const { toasts, notify, dismiss } = useToasts();
  const prefersDark = usePrefersDark();

  const [source, setSource] = useState<WorkspaceSource | "">("");
  // Library projects (desktop app): the open one saves as it's edited, and
  // shows changes made elsewhere (an AI assistant through the MCP server).
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const sourceRef = useRef(source);
  // Read before the effect below overwrites it.
  const [storedSource] = useState(() => readStorage(SOURCE_KEY) ?? "");
  // The library's copy as last loaded or saved, to tell our saves from others'.
  const synced = useRef<{ workspace: string; env: string } | null>(null);
  const libraryTimer = useRef<number | undefined>(undefined);
  const [saved, setSaved] = useState(listSaved);
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<PanelTab>("transaction");
  // Opens by itself on a first visit to the web version; the app has its
  // own onboarding and card server, so there it only opens from Help.
  const [aboutOpen, setAboutOpen] = useState(
    () => !inApp && readStorage(ABOUT_SEEN_KEY) === null,
  );
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [currentTransaction, setTransaction] =
    useState<TransactionInput>(defaultTransaction);
  const [currentEnvironment, setEnvironment] = useState<EnvironmentRow[]>([]);
  const environment = currentEnvironment;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<ExecutionItem[] | null>(null);
  const [outputFor, setOutputFor] = useState<TransactionInput | null>(null);
  const [toolboxVisible, setToolboxVisible] = useState(initialToolboxVisible);
  const [panelVisible, setPanelVisible] = useState(
    () => readStorage(PANEL_KEY) !== "false",
  );
  // Read on inject, so a re-created workspace keeps the current choice.
  const toolboxVisibleRef = useRef(toolboxVisible);

  // Width of the side panel; the handle sits between editor and panel.
  const panel = useResizable({
    storageKey: STORAGE_PREFIX + "panelWidth",
    initial: 380,
    min: 300,
    max: () => window.innerWidth * 0.6,
    axis: "x",
    direction: -1,
  });

  const loadState = useCallback((state: WorkspaceState) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    Blockly.serialization.workspaces.load(state, workspace);
    setCode(generator.workspaceToCode(workspace));
  }, []);

  /** Saves the open library project shortly after an edit. */
  const scheduleLibrarySave = useCallback(() => {
    const id = projectId(sourceRef.current);
    if (!id) return;
    window.clearTimeout(libraryTimer.current);
    libraryTimer.current = window.setTimeout(async () => {
      const workspace = workspaceRef.current;
      if (!workspace || projectId(sourceRef.current) !== id) return;
      const state = Blockly.serialization.workspaces.save(workspace);
      const json = JSON.stringify(state);
      if (synced.current?.workspace === json) return;
      try {
        await saveProject(id, { workspace: state });
        if (synced.current)
          synced.current = { ...synced.current, workspace: json };
      } catch (e) {
        notify(`Couldn't save the project: ${(e as Error).message}`, "error");
      }
    }, LIBRARY_SAVE_DELAY_MS);
  }, [notify]);

  const onInject = useCallback(
    (workspace: Blockly.WorkspaceSvg) => {
      workspaceRef.current = workspace;
      applyToolboxVisible(workspace, toolboxVisibleRef.current);
      workspace.addChangeListener((event) => {
        if (event.isUiEvent) return;
        // Keep the code view in sync and autosave shortly after edits.
        setCode(generator.workspaceToCode(workspace));
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = window.setTimeout(
          () => writeAutosave(Blockly.serialization.workspaces.save(workspace)),
          AUTOSAVE_DELAY_MS,
        );
        scheduleLibrarySave();
      });

      // Pick up where the viewer left off, or start from an example.
      const autosave = readAutosave();
      if (autosave) {
        try {
          loadState(autosave);
          const saved = readStorage(SOURCE_KEY) ?? "";
          if (/^(example|saved):/.test(saved)) {
            setSource(saved as WorkspaceSource);
          }
          return;
        } catch {
          // A broken autosave falls through to the default example.
        }
      }
      const example = examples[DEFAULT_EXAMPLE];
      if (example) {
        loadState(example.state);
        setSource(`example:${DEFAULT_EXAMPLE}`);
        // First visit: start with the write-up.
        if (example.guide) setTab("guide");
      }
    },
    [loadState, scheduleLibrarySave],
  );

  useEffect(() => () => window.clearTimeout(autosaveTimer.current), []);
  useEffect(() => {
    writeStorage(SOURCE_KEY, source);
    sourceRef.current = source;
  }, [source]);

  // What to call the open workspace: a project's name rather than its id.
  const currentName =
    projects.find((project) => project.id === projectId(source))?.name ??
    sourceName(source);

  // The open example's write-up, if it has one.
  const currentExample = source.startsWith("example:")
    ? examples[sourceName(source)]
    : undefined;
  const guide = currentExample?.guide;
  const activeTab: PanelTab = tab === "guide" && !guide ? "transaction" : tab;

  function toggleToolbox() {
    const visible = !toolboxVisible;
    setToolboxVisible(visible);
    toolboxVisibleRef.current = visible;
    writeStorage(TOOLBOX_KEY, String(visible));
    if (workspaceRef.current)
      applyToolboxVisible(workspaceRef.current, visible);
  }

  function showPanel(visible: boolean) {
    setPanelVisible(visible);
    writeStorage(PANEL_KEY, String(visible));
  }

  /** Shows a library project: its blocks and environment variables. */
  function showProject(project: Project) {
    synced.current = {
      workspace: JSON.stringify(project.workspace ?? {}),
      env: JSON.stringify(project.env),
    };
    sourceRef.current = `project:${project.id}`;
    setSource(`project:${project.id}`);
    loadState((project.workspace ?? {}) as WorkspaceState);
    setEnvironment(
      Object.entries(project.env).map(([name, value]) => ({ name, value })),
    );
  }

  async function openProject(id: string, { ask = true } = {}) {
    if (id === projectId(sourceRef.current)) return;
    try {
      const project = await getProject(id);
      if (project.kind !== "blocks") {
        notify(
          `"${project.name}" is JavaScript; open it in Card code.`,
          "info",
        );
        return;
      }
      // A project already saves itself, so leaving one needs no warning.
      if (ask && !projectId(sourceRef.current) && !(await confirmReplace()))
        return;
      showProject(project);
      notify(`Opened "${project.name}".`);
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }

  useEffect(() => watchProjectList((list) => setProjects(list)), []);
  // Reopen the project that was open last time, from the library's copy.
  const reopenProject = useEffectEvent(() => {
    const id = projectId(storedSource as WorkspaceSource);
    if (id && hasLibrary()) void openProject(id, { ask: false });
  });
  useEffect(() => {
    // After the autosave has loaded on inject.
    const timer = window.setTimeout(() => reopenProject(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  // Someone else (an AI assistant, the other editor) changed the project.
  const onLibraryChange = useEffectEvent(async (ids: string[]) => {
    const id = projectId(sourceRef.current);
    if (!id || !ids.includes(id)) return;
    let project: Project;
    try {
      project = await getProject(id);
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        notify(
          "The open project was deleted or renamed in the library.",
          "info",
        );
        setSource("");
        synced.current = null;
      }
      return;
    }
    const workspace = JSON.stringify(project.workspace ?? {});
    const env = JSON.stringify(project.env);
    const last = synced.current;
    if (last?.workspace === workspace && last.env === env) return;
    synced.current = { workspace, env };
    const current = workspaceRef.current
      ? JSON.stringify(
          Blockly.serialization.workspaces.save(workspaceRef.current),
        )
      : "";
    if (current !== workspace)
      loadState((project.workspace ?? {}) as WorkspaceState);
    if (JSON.stringify(envObject(environment)) !== env) {
      setEnvironment(
        Object.entries(project.env).map(([name, value]) => ({ name, value })),
      );
    }
    notify(`"${project.name}" was updated in the library.`, "info");
  });
  useEffect(() => watchProjects((ids) => void onLibraryChange(ids)), []);

  // The open project's environment variables save with it.
  useEffect(() => {
    const id = projectId(source);
    if (!id || !synced.current) return;
    const env = envObject(environment);
    const json = JSON.stringify(env);
    if (synced.current.env === json) return;
    const timer = window.setTimeout(() => {
      saveProject(id, { env }).then(
        () => {
          if (synced.current) synced.current = { ...synced.current, env: json };
        },
        (e: Error) =>
          notify(`Couldn't save the variables: ${e.message}`, "error"),
      );
    }, LIBRARY_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [environment, source, notify]);

  function hasBlocks() {
    return (workspaceRef.current?.getTopBlocks(false).length ?? 0) > 0;
  }
  async function confirmReplace() {
    return (
      !hasBlocks() ||
      confirmAction({
        message: "Replace the current workspace?",
        detail: "Export or save it first if you want to keep it.",
        confirmLabel: "Replace",
        destructive: true,
      })
    );
  }

  async function open(next: WorkspaceSource) {
    const id = projectId(next);
    if (id) {
      await openProject(id);
      return;
    }
    if (!projectId(sourceRef.current) && !(await confirmReplace())) return;
    synced.current = null;
    const name = sourceName(next);
    const example = next.startsWith("example:") ? examples[name] : undefined;
    const state = example ? example.state : readSaved(name);
    if (!state) {
      notify(`Could not open "${name}".`, "error");
      return;
    }
    try {
      loadState(state);
      setSource(next);
      if (example?.guide) setTab("guide");
      // Add the variables the example reads, keeping any values already set.
      const needed = example?.env ?? [];
      const missing = needed.filter(
        (variable) => !environment.some((row) => row.name === variable),
      );
      if (missing.length) {
        setEnvironment([
          ...environment,
          ...missing.map((variable) => ({ name: variable, value: "" })),
        ]);
      }
      const unset = needed.filter(
        (variable) => !environment.find((row) => row.name === variable)?.value,
      );
      notify(
        unset.length
          ? `Opened "${name}". Set ${unset.join(", ")} under Environment variables.`
          : `Opened "${name}".`,
        unset.length ? "info" : "success",
      );
    } catch (e) {
      notify(`"${name}" could not be loaded: ${(e as Error).message}`, "error");
    }
  }

  async function saveAs(name: string) {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    if (hasLibrary()) {
      try {
        const project = await createProject({
          name,
          kind: "blocks",
          workspace: Blockly.serialization.workspaces.save(workspace),
          env: envObject(environment),
        });
        synced.current = {
          workspace: JSON.stringify(project.workspace ?? {}),
          env: JSON.stringify(project.env),
        };
        sourceRef.current = `project:${project.id}`;
        setSource(`project:${project.id}`);
        setSaveAsOpen(false);
        notify(`Saved "${project.name}" in the card code library.`);
      } catch (e) {
        notify((e as Error).message, "error");
      }
      return;
    }
    if (
      saved.includes(name) &&
      !(await confirmAction({
        message: `Replace the saved workspace "${name}"?`,
        confirmLabel: "Replace",
        destructive: true,
      }))
    ) {
      return;
    }
    if (writeSaved(name, Blockly.serialization.workspaces.save(workspace))) {
      setSaved(listSaved());
      setSource(`saved:${name}`);
      setSaveAsOpen(false);
      notify(`Saved "${name}".`);
    } else {
      notify(`Could not save "${name}".`, "error");
    }
  }

  async function exportWorkspace() {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const saved = await downloadWorkspace(
      currentName || "workspace",
      Blockly.serialization.workspaces.save(workspace),
    );
    // In the app the Save panel says where; a browser shows its download.
    if (saved && window.sandboxApp) notify(`Exported to ${saved}.`);
  }

  async function importWorkspace(file: File) {
    try {
      const state = await readWorkspaceFile(file);
      if (!(await confirmReplace())) return;
      loadState(state);
      setSource("");
      notify(`Imported ${file.name}.`);
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }

  /** Copies a link that opens this workspace, for sharing or bookmarking. */
  async function shareWorkspace() {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    try {
      const url = await shareUrl(
        window.location.href,
        Blockly.serialization.workspaces.save(workspace),
        currentName || undefined,
      );
      await navigator.clipboard.writeText(url);
      notify("Copied a link that opens this workspace.");
    } catch {
      notify("Could not copy the link.", "error");
    }
  }

  // Opens a workspace packed into the URL (#import=…), e.g. a snippet an AI
  // assistant made with the MCP server. Runs on load and on hash changes.
  const openSharedLink = useEffectEvent(async () => {
    const shared = readShareHash(window.location.hash);
    if (!shared) return;
    // Drop the fragment so a reload doesn't re-import over later edits.
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    const label = shared.name ? `"${shared.name}"` : "the shared snippet";
    try {
      const state = await decodeWorkspace(shared.data);
      if (
        hasBlocks() &&
        !(await confirmAction({
          message: `Open ${label} from the link?`,
          detail:
            "It replaces the current workspace. Export or save it first if you want to keep it.",
          confirmLabel: "Open",
        }))
      ) {
        return;
      }
      loadState(state);
      setSource("");
      notify(`Opened ${label} from a link.`);
    } catch (e) {
      notify((e as Error).message, "error");
    }
  });
  useEffect(() => {
    const listener = () => void openSharedLink();
    // After the autosave or default example has loaded on inject.
    const timer = window.setTimeout(listener, 0);
    window.addEventListener("hashchange", listener);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", listener);
    };
  }, []);

  async function clearWorkspace() {
    if (!(await confirmReplace())) return;
    workspaceRef.current?.clear();
    setCode("");
    setSource("");
  }

  async function run(
    transaction: TransactionInput = currentTransaction,
    environment: EnvironmentRow[] = currentEnvironment,
  ) {
    const workspace = workspaceRef.current;
    if (!workspace || running) return;
    const invalid = validateTransaction(transaction);
    if (invalid) {
      setTab("transaction");
      notify(invalid, "error");
      return;
    }
    const environmentVariables = Object.fromEntries(
      environment.filter((row) => row.name).map((row) => [row.name, row.value]),
    );
    const input = {
      ...transaction,
      merchantName: transaction.merchantName.trim(),
      merchantCity: transaction.merchantCity.trim(),
    };
    setRunning(true);
    setError("");
    try {
      setOutput(
        await simulate(generateCode(workspace), input, environmentVariables),
      );
      setOutputFor(input);
    } catch (e) {
      setOutput(null);
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setTab("results");
      // Show the outcome even when the panel was tucked away.
      showPanel(true);
    }
  }

  /** Fills in the guide's scenario and runs it. */
  function runScenario(scenario: Scenario) {
    const next = { ...defaultTransaction, ...scenario.transaction };
    let rows = environment;
    for (const [name, value] of Object.entries(scenario.env ?? {})) {
      rows = rows.some((row) => row.name === name)
        ? rows.map((row) => (row.name === name ? { ...row, value } : row))
        : [...rows, { name, value }];
    }
    setTransaction(next);
    setEnvironment(rows);
    void run(next, rows);
  }

  // Cmd/Ctrl+Enter runs from anywhere on the page; Cmd/Ctrl+B shows or
  // hides the blocks, and Cmd/Ctrl+J the side panel.
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "enter") {
      event.preventDefault();
      void run();
    } else if (key === "b") {
      event.preventDefault();
      toggleToolbox();
    } else if (key === "j") {
      event.preventDefault();
      showPanel(!panelVisible);
    }
  });
  // The desktop app's Card Code menu.
  const onMenuAction = useEffectEvent((action: string) => {
    if (action === "run") void run();
    else if (action === "save-as") setSaveAsOpen(true);
    else if (action === "export") void exportWorkspace();
    else if (action === "toggle-blocks") toggleToolbox();
    else if (action === "toggle-panel") showPanel(!panelVisible);
    else if (action.startsWith("open-project:")) {
      void openProject(action.slice("open-project:".length));
    } else if (action === "import") {
      const picker = Object.assign(document.createElement("input"), {
        type: "file",
        accept: ".json,application/json",
      });
      picker.addEventListener("change", () => {
        const file = picker.files?.[0];
        if (file) void importWorkspace(file);
      });
      picker.click();
    }
  });
  useEffect(
    () => window.sandboxApp?.onAction((action) => onMenuAction(action)),
    [],
  );

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // A dot on the Results tab shows the outcome of the last run.
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

  return (
    <div
      className={`flex flex-col ${
        // In the app: one fixed window, never a scrolling page.
        inApp ? "h-dvh overflow-hidden" : "min-h-dvh lg:h-dvh"
      } ${panel.dragging ? "cursor-col-resize select-none" : ""}`}
    >
      <Header
        examples={exampleNames}
        saved={saved}
        projects={projects.filter((project) => project.kind === "blocks")}
        source={source}
        running={running}
        toolboxVisible={toolboxVisible}
        onToggleToolbox={toggleToolbox}
        panelVisible={panelVisible}
        onTogglePanel={() => showPanel(!panelVisible)}
        onAbout={() => setAboutOpen(true)}
        onOpen={(next) => void open(next)}
        onSaveAs={() => setSaveAsOpen(true)}
        onImport={(file) => void importWorkspace(file)}
        onExport={() => void exportWorkspace()}
        onShare={() => void shareWorkspace()}
        onClear={() => void clearWorkspace()}
        onRun={() => void run()}
      />
      <main
        className={`flex min-h-0 flex-1 ${inApp ? "flex-row" : "flex-col lg:flex-row"}`}
      >
        <BlocklyWorkspace
          className={
            inApp
              ? "min-h-0 min-w-0 flex-1"
              : `min-w-0 lg:h-auto lg:min-h-0 lg:flex-1 ${
                  panelVisible ? "h-[60vh] min-h-80" : "min-h-0 flex-1"
                }`
          }
          options={options}
          theme={prefersDark ? darkTheme : lightTheme}
          onInject={onInject}
        />
        {panelVisible && (
          <ResizeHandle
            resizable={panel}
            label="Resize side panel"
            className={`border-l border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900 ${
              inApp ? "flex" : "hidden lg:flex"
            }`}
          />
        )}
        <SidePanel
          tab={activeTab}
          onTabChange={setTab}
          resultsBadge={resultsBadge}
          showGuide={Boolean(guide)}
          // Hidden rather than unmounted, so the guide keeps its scroll.
          hidden={!panelVisible}
          className={
            inApp
              ? "w-[var(--panel-width)] shrink-0"
              : "border-t lg:w-[var(--panel-width)] lg:shrink-0 lg:border-t-0"
          }
          style={{ "--panel-width": `${panel.size}px` } as CSSProperties}
        >
          {activeTab === "guide" && guide && (
            <GuideView
              name={sourceName(source)}
              guide={guide}
              envNames={currentExample?.env ?? []}
              environment={environment}
              running={running}
              onRunScenario={runScenario}
              onShowEnvironment={() => setTab("transaction")}
            />
          )}
          {activeTab === "transaction" && (
            <TransactionForm
              transaction={currentTransaction}
              onTransactionChange={setTransaction}
              environment={environment}
              onEnvironmentChange={setEnvironment}
              environmentSaved={Boolean(projectId(source))}
              running={running}
              onRun={() => void run()}
            />
          )}
          {activeTab === "results" && (
            <ResultsView
              items={output}
              transaction={outputFor}
              error={error}
              onShowServerHelp={inApp ? undefined : () => setAboutOpen(true)}
            />
          )}
          {activeTab === "code" && (
            <CodeView code={code} onCopied={() => notify("Code copied.")} />
          )}
        </SidePanel>
      </main>
      {!inApp && <Footer />}
      <NameDialog
        open={saveAsOpen}
        title="Save workspace"
        label={inApp ? "Name" : "Save this workspace in the browser as"}
        initial={currentName}
        confirmLabel="Save"
        onSubmit={(name) => void saveAs(name)}
        onClose={() => setSaveAsOpen(false)}
      />
      <AboutDialog
        open={aboutOpen}
        onClose={() => {
          setAboutOpen(false);
          writeStorage(ABOUT_SEEN_KEY, "1");
        }}
      />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
