'use client';

import { CheckCircle2, X, XCircle } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { desktopApp, useInApp } from '@/lib/desktop';

interface Toast {
  message: string;
  error: boolean;
}

type Notify = (message: string, options?: { error?: boolean }) => void;

// Fired on window for every message, e.g. so a sheet can close when its
// action succeeds.
export const TOAST_EVENT = 'sandbox:toast';
export type ToastEventDetail = Toast;

const ToastContext = createContext<Notify>(() => {});

// A single status message, cleared after a few seconds. On the web it's a
// banner at the top of the page; in the desktop app a compact status at the
// bottom, and a system notification as well when the window isn't in front.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inApp = useInApp();

  const notify = useCallback<Notify>((message, options) => {
    const next = { message, error: options?.error ?? false };
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), 4000);
    window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail: next }));
    if (!document.hasFocus()) desktopApp()?.notify(message, { error: next.error });
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={
            inApp
              ? `fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[min(32rem,calc(100%-2rem))] items-center gap-2 rounded-full px-4 py-2 text-sm shadow-lg ring-1 backdrop-blur ${
                  toast.error
                    ? 'bg-red-600/95 text-white ring-red-700/40'
                    : 'bg-gray-900/90 text-white ring-black/10 dark:bg-gray-100/95 dark:text-gray-900'
                }`
              : `fixed inset-x-0 top-4 z-50 mx-auto flex w-[min(36rem,calc(100%-2rem))] items-start gap-3 rounded-lg p-4 shadow-lg ring-1 ${
                  toast.error
                    ? 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900'
                    : 'bg-green-50 text-green-800 ring-green-200 dark:bg-green-950 dark:text-green-200 dark:ring-green-900'
                }`
          }
        >
          {toast.error ? (
            <XCircle className={`${inApp ? 'h-4 w-4' : 'h-5 w-5'} shrink-0`} />
          ) : (
            <CheckCircle2 className={`${inApp ? 'h-4 w-4 text-emerald-400 dark:text-emerald-600' : 'h-5 w-5'} shrink-0`} />
          )}
          <p className={`flex-1 font-medium ${inApp ? '' : 'text-sm'}`}>{toast.message}</p>
          <button type="button" onClick={() => setToast(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <span className="sr-only">Dismiss</span>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): Notify {
  return useContext(ToastContext);
}

// Run an action, then report success (unless the message is empty) or the
// API's error message.
export function useAction() {
  const notify = useToast();
  return async function run<T>(action: () => Promise<T>, success: string | ((value: T) => string)) {
    try {
      const value = await action();
      const message = typeof success === 'function' ? success(value) : success;
      if (message) notify(message);
      return value;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), { error: true });
      return undefined;
    }
  };
}
