'use client';

import { useSyncExternalStore } from 'react';

// Inside the Investec Sandbox desktop app, a preload script gives pages
// `window.sandboxApp`: native confirm sheets, Save panels, notifications and
// the toolbar's page actions. In a browser it's missing, and everything here
// falls back to the web way.

type ConfirmOptions = { message: string; detail?: string; confirmLabel: string; destructive?: boolean };

interface SandboxApp {
  confirm(options: ConfirmOptions): Promise<boolean>;
  saveFile(fileName: string, text: string): Promise<string | null>;
  notify(message: string, options?: { error?: boolean }): void;
  onAction(callback: (id: string) => void): () => void;
}

// Addresses the app chose at runtime, from /sandbox-config.js.
interface SandboxConfig {
  apiUrl?: string;
  cardServerUrl?: string;
}

declare global {
  interface Window {
    sandboxApp?: SandboxApp;
    __SANDBOX_CONFIG__?: SandboxConfig;
  }
}

export function desktopApp(): SandboxApp | undefined {
  return typeof window === 'undefined' ? undefined : window.sandboxApp;
}

export function runtimeConfig(): SandboxConfig {
  return (typeof window !== 'undefined' && window.__SANDBOX_CONFIG__) || {};
}

const noop = () => () => {};

/** True inside the desktop app (false while rendering on the server). */
export function useInApp(): boolean {
  return useSyncExternalStore(
    noop,
    () => Boolean(window.sandboxApp),
    () => false,
  );
}

/** A native confirm sheet in the app; window.confirm in a browser. */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const app = desktopApp();
  if (app) return app.confirm(options);
  return window.confirm(options.detail ? `${options.message}\n\n${options.detail}` : options.message);
}

/**
 * Saves text as a file: a native Save panel in the app (resolves to the path,
 * or null if cancelled), a download in a browser (resolves to the name).
 */
export async function saveTextFile(fileName: string, text: string): Promise<string | null> {
  const app = desktopApp();
  if (app) return app.saveFile(fileName, text);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return fileName;
}
