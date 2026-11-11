import type { Metadata } from 'next';
import TransactionsPanel from '@/components/dashboard/TransactionsPanel';

export const metadata: Metadata = { title: 'Transactions | Programmable Banking Sandbox' };

export default function Page() {
  return <TransactionsPanel />;
}
