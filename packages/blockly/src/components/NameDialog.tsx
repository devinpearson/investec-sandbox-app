import { useEffect, useRef, useState, type FormEvent } from "react";

type Props = {
  open: boolean;
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
};

/**
 * Asks for a name. Used instead of window.prompt, which desktop apps built
 * on Electron don't support.
 */
export function NameDialog({
  open,
  title,
  label,
  initial,
  confirmLabel,
  onSubmit,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setName(initial);
      element.showModal();
      requestAnimationFrame(() => input.current?.select());
    } else if (!open && element.open) {
      element.close();
    }
  }, [open, initial]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="name-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-gray-900 shadow-2xl ring-1 ring-black/5 backdrop:bg-gray-950/40 dark:bg-gray-900 dark:text-gray-100 dark:ring-white/10"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <h2 id="name-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">{label}</span>
          <input
            ref={input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 block w-full rounded-md border-0 bg-white px-3 py-1.5 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600 dark:bg-gray-800 dark:text-gray-100 dark:ring-gray-700"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
