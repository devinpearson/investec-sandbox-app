import type { Metadata } from 'next';
import AccountsPanel from '@/components/dashboard/AccountsPanel';

export const metadata: Metadata = { title: 'Accounts | Programmable Banking Sandbox' };

export default function Page() {
  return <AccountsPanel />;
}
