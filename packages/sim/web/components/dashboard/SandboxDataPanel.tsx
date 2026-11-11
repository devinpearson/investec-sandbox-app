'use client';

import { useRef, useState } from 'react';
import { DatabaseZap, Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button, Panel, Select } from '@/components/ui';
import { useAction, useToast } from '@/components/ToastProvider';
import { useRefreshSandbox, useScenarios } from '@/hooks/useSandbox';
import { clearDatabase, exportState, importState, loadScenario, resetDatabase } from '@/lib/api/sandbox';
import { confirmAction, saveTextFile } from '@/lib/desktop';
import SummaryCards from './SummaryCards';

// One action in the Data panel: what it does, then its button.
function DataAction({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 max-w-xl">
        <p className="text-sm font-medium text-gray-900 dark:text-white">{title}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      {children}
    </li>
  );
}

// Start from a scenario, reset or clear the sandbox, or move its data in
// and out as a file.
export default function SandboxDataPanel() {
  const { data: scenarios = [] } = useScenarios();
  const [selected, setSelected] = useState('');
  const run = useAction();
  const refresh = useRefreshSandbox();
  const description = scenarios.find(s => s.id === selected)?.description;
  const fileInput = useRef<HTMLInputElement>(null);
  const notify = useToast();

  async function act<T>(action: () => Promise<T>, success: string | ((value: T) => string)) {
    await run(action, success);
    await refresh();
  }

  async function importFile(file: File) {
    let state: unknown;
    try {
      state = JSON.parse(await file.text());
    } catch {
      notify(`${file.name} is not valid JSON`, { error: true });
      return;
    }
    const confirmed = await confirmAction({
      message: `Replace the sandbox's data with ${file.name}?`,
      detail: 'All accounts, transactions, beneficiaries and cards are replaced.',
      confirmLabel: 'Replace',
      destructive: true,
    });
    if (!confirmed) return;
    await act(
      () => importState(state),
      counts => `Imported ${file.name}: ${counts.accounts} accounts, ${counts.transactions} transactions, ${counts.cards} cards`,
    );
  }

  return (
    <>
      <Panel id="scenarios" title="Scenarios" description="Replace the sandbox's data with a ready-made setup.">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="scenario" className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              Scenario
            </label>
            <Select id="scenario" value={selected} onChange={e => setSelected(e.target.value)} className="mt-1 w-64">
              <option value="">Select a scenario</option>
              {scenarios.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            disabled={!selected}
            onClick={() => act(() => loadScenario(selected), value => `Loaded scenario: ${value?.name ?? selected}`)}
          >
            <DatabaseZap className="h-4 w-4" aria-hidden="true" />
            Load scenario
          </Button>
        </div>
        {description && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </Panel>

      <Panel id="data" title="Data" description={<SummaryCards />}>
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          <DataAction title="Reset" description="Back to the seed data: one profile with its accounts, transactions, beneficiaries and card.">
            <Button variant="dark" onClick={() => act(resetDatabase, 'Sandbox reset to the seed data')}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset data
            </Button>
          </DataAction>
          <DataAction title="Clear" description="Remove every profile, account, transaction, beneficiary and card.">
            <Button
              variant="secondary"
              onClick={async () => {
                const confirmed = await confirmAction({
                  message: 'Clear the sandbox data?',
                  detail: 'Every profile, account, transaction, beneficiary and card is removed. Reset brings back the seed data.',
                  confirmLabel: 'Clear Data',
                  destructive: true,
                });
                if (confirmed) void act(clearDatabase, 'Sandbox data cleared');
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Clear data
            </Button>
          </DataAction>
          <DataAction
            title="Export"
            description="Save the data as a JSON file, to share a setup or keep it. Settings, faults and exchange rates are left out."
          >
            <Button
              variant="secondary"
              onClick={() =>
                run(async () => {
                  const { fileName, json } = await exportState();
                  return saveTextFile(fileName, json);
                }, saved => (saved ? `Exported the sandbox to ${saved}` : ''))
              }
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export
            </Button>
          </DataAction>
          <DataAction title="Import" description="Replace the data with an exported file, all or nothing.">
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import
            </Button>
          </DataAction>
        </ul>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Import a sandbox file"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </Panel>
    </>
  );
}
