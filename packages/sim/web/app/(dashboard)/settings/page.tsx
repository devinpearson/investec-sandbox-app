import type { Metadata } from 'next';
import SettingsPanel from '@/components/dashboard/SettingsPanel';

export const metadata: Metadata = { title: 'Settings | Programmable Banking Sandbox' };

export default function Page() {
  return <SettingsPanel />;
}
