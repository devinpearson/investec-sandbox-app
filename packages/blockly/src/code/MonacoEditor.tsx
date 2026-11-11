import { useEffect, useEffectEvent, useRef } from "react";
import { ENV_URI, MAIN_URI, monaco } from "./monaco";

export type CodeFile = "main.js" | "env.json";

export type MonacoHandle = {
  getValue(file: CodeFile): string;
  setValue(file: CodeFile, text: string): void;
  focus(): void;
};

type Props = {
  file: CodeFile;
  initial: Record<CodeFile, string>;
  dark: boolean;
  onChange: (file: CodeFile, text: string) => void;
  /** ⌘↵ inside the editor (Monaco would otherwise insert a line). */
  onRun: () => void;
  onReady: (handle: MonacoHandle) => void;
  className?: string;
};

// Backgrounds that match the page around the editor.
monaco.editor.defineTheme("sandbox-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: { "editor.background": "#ffffff" },
});
monaco.editor.defineTheme("sandbox-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#111827",
    "editorGutter.background": "#111827",
  },
});

const uris: Record<CodeFile, monaco.Uri> = {
  "main.js": MAIN_URI,
  "env.json": ENV_URI,
};
const languages: Record<CodeFile, string> = {
  "main.js": "javascript",
  "env.json": "json",
};

function modelFor(file: CodeFile, text: string) {
  const existing = monaco.editor.getModel(uris[file]);
  if (existing) return existing;
  return monaco.editor.createModel(text, languages[file], uris[file]);
}

/** One Monaco editor that switches between the two files' models. */
export function MonacoEditor({
  file,
  initial,
  dark,
  onChange,
  onRun,
  onReady,
  className = "",
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const viewStates = useRef(
    new Map<CodeFile, monaco.editor.ICodeEditorViewState | null>(),
  );
  const current = useRef<CodeFile>(file);
  // The latest callbacks, for listeners registered once.
  const changed = useEffectEvent((name: CodeFile, text: string) =>
    onChange(name, text),
  );
  const ran = useEffectEvent(() => onRun());
  const ready = useEffectEvent((handle: MonacoHandle) => onReady(handle));

  useEffect(() => {
    const models = {
      "main.js": modelFor("main.js", initial["main.js"]),
      "env.json": modelFor("env.json", initial["env.json"]),
    } satisfies Record<CodeFile, monaco.editor.ITextModel>;
    const editor = monaco.editor.create(host.current!, {
      model: models[current.current],
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
      tabSize: 2,
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      padding: { top: 12 },
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      ran(),
    );
    const subscriptions = (Object.keys(models) as CodeFile[]).map((name) =>
      models[name].onDidChangeContent(() =>
        changed(name, models[name].getValue()),
      ),
    );
    ready({
      getValue: (name) => models[name].getValue(),
      setValue: (name, text) => {
        const model = models[name];
        if (model.getValue() === text) return;
        // An edit rather than setValue, so ⌘Z can undo it.
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text }],
          () => null,
        );
      },
      focus: () => editor.focus(),
    });
    return () => {
      subscriptions.forEach((s) => s.dispose());
      editor.dispose();
      editorRef.current = null;
    };
    // Created once; the props below are applied by their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(dark ? "sandbox-dark" : "sandbox-light");
  }, [dark]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || current.current === file) return;
    viewStates.current.set(current.current, editor.saveViewState());
    current.current = file;
    editor.setModel(monaco.editor.getModel(uris[file]));
    const state = viewStates.current.get(file);
    if (state) editor.restoreViewState(state);
    editor.focus();
  }, [file]);

  return <div ref={host} className={className} />;
}
