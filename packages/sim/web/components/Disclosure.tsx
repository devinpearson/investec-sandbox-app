'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { desktopApp, useInApp } from '@/lib/desktop';
import { TOAST_EVENT, type ToastEventDetail } from './ToastProvider';

const storageKey = (id: string) => `sandbox-open-${id}`;

/**
 * A part of a panel that stays folded until it's needed, such as a form.
 * Whether it's open is remembered per browser.
 *
 * In the desktop app it's a sheet instead: the toolbar has a button for it
 * (its `id` is the action), and it closes once its action succeeds.
 */
export default function Disclosure({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const inApp = useInApp();
  return inApp ? (
    <Sheet id={id} title={title}>
      {children}
    </Sheet>
  ) : (
    <Folded id={id} title={title}>
      {children}
    </Folded>
  );
}

function Folded({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storageKey(id)) === 'true');
    } catch {
      // Storage blocked: start folded.
    }
  }, [id]);

  function remember(next: boolean) {
    setOpen(next);
    try {
      localStorage.setItem(storageKey(id), String(next));
    } catch {
      // Storage blocked: only this visit remembers.
    }
  }

  return (
    <details
      open={open}
      onToggle={e => {
        const next = e.currentTarget.open;
        if (next !== open) remember(next);
      }}
      className="group mt-6 border-t border-gray-100 pt-4 dark:border-gray-700"
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-gray-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
        {title}
      </summary>
      {children}
    </details>
  );
}

function Sheet({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  // The toolbar asks for this sheet by id.
  useEffect(
    () =>
      desktopApp()?.onAction(action => {
        const sheet = dialog.current;
        if (action !== id || !sheet || sheet.open) return;
        sheet.showModal();
        // Start in the first field, not on the close button.
        sheet.querySelector<HTMLElement>('.sheet-body :is(input:not([type=checkbox]), select, textarea)')?.focus();
      }),
    [id],
  );

  // Done once the form's action reports success.
  useEffect(() => {
    function onToast(event: Event) {
      if (dialog.current?.open && !(event as CustomEvent<ToastEventDetail>).detail.error) dialog.current.close();
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-sheet-title`}
      onClick={event => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
      // A sheet: attached to the top of the page, under the app's toolbar.
      className="mx-auto mt-0 w-[min(38rem,calc(100%-2rem))] rounded-b-xl bg-white p-0 text-gray-900 shadow-2xl ring-1 ring-black/10 backdrop:bg-black/25 dark:bg-gray-800 dark:text-gray-100 dark:ring-white/10"
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <h2 id={`${id}-sheet-title`} className="text-sm font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <span className="sr-only">Cancel</span>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {/* sheet-body: globals.css lays the form out for the sheet's width. */}
      <div className="sheet-body max-h-[75vh] overflow-y-auto px-5 pb-5 [&>*:first-child]:mt-4">{children}</div>
    </dialog>
  );
}
