'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { FaultBanner } from './FaultsPanel';
import { LiveUpdatesProvider } from './LiveUpdates';
import { SECTION_GROUPS } from './sections';
import { ClockBanner } from './TimePanel';

// The frame around every dashboard page: the pages' navigation, the
// warnings that apply everywhere (faults on, clock moved) and the live
// connection to the API.
//
// The navigation is marked data-web-only: the desktop app hides it and
// lists the same pages in its own sidebar.
export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <LiveUpdatesProvider>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:px-8">
        <nav data-web-only aria-label="Dashboard" className="shrink-0 lg:w-52">
          <div className="flex gap-6 overflow-x-auto pb-1 lg:sticky lg:top-6 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
            {SECTION_GROUPS.map(group => (
              <div key={group.label} className="min-w-max lg:min-w-0">
                <p className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {group.label}
                </p>
                <ul className="mt-1 flex gap-1 lg:flex-col">
                  {group.sections.map(({ href, label, icon: Icon }) => {
                    const current = pathname === href;
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          aria-current={current ? 'page' : undefined}
                          className={`flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium ${
                            current
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                              : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div data-dashboard-content className="flex min-w-0 flex-1 flex-col gap-6">
          <FaultBanner />
          <ClockBanner />
          {children}
        </div>
      </div>
    </LiveUpdatesProvider>
  );
}
