// Inside the Investec Sandbox desktop app, a preload script gives pages
// `window.sandboxApp` (native confirm sheets and Save panels), and the app
// serves the addresses it chose in /sandbox-config.js. In a browser both are
// missing, and these fall back to the web way.

type ConfirmOptions = {
  message: string;
  detail?: string;
  confirmLabel: string;
  destructive?: boolean;
};

interface SandboxApp {
  confirm(options: ConfirmOptions): Promise<boolean>;
  saveFile(fileName: string, text: string): Promise<string | null>;
  /** The app's Card Code menu: run, save-as, import, export, toggle-blocks, toggle-panel, open-project:<id>. */
  onAction(callback: (id: string) => void): () => void;
}

declare global {
  interface Window {
    sandboxApp?: SandboxApp;
    __SANDBOX_CONFIG__?: {
      apiUrl?: string;
      cardServerUrl?: string;
      /** The card code library (the MCP server), in the desktop app. */
      libraryUrl?: string;
    };
  }
}

export const runtimeConfig = () =>
  (typeof window !== "undefined" && window.__SANDBOX_CONFIG__) || {};

/** A native confirm sheet in the app; window.confirm in a browser. */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const app = window.sandboxApp;
  if (app) return app.confirm(options);
  return window.confirm(
    options.detail
      ? `${options.message}\n\n${options.detail}`
      : options.message,
  );
}

/**
 * Saves text as a file: a native Save panel in the app (the path, or null if
 * cancelled), a download in a browser (the file name).
 */
export async function saveTextFile(
  fileName: string,
  text: string,
): Promise<string | null> {
  const app = window.sandboxApp;
  if (app) return app.saveFile(fileName, text);
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return fileName;
}
