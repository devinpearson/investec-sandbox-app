import type { Metadata } from 'next';
import SandboxDataPanel from '@/components/dashboard/SandboxDataPanel';

export const metadata: Metadata = { title: 'Data & scenarios | Programmable Banking Sandbox' };

export default function Page() {
  return <SandboxDataPanel />;
}
