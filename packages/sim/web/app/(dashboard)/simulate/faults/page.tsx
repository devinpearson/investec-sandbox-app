import type { Metadata } from 'next';
import FaultsPanel from '@/components/dashboard/FaultsPanel';

export const metadata: Metadata = { title: 'Faults | Programmable Banking Sandbox' };

export default function Page() {
  return <FaultsPanel />;
}
