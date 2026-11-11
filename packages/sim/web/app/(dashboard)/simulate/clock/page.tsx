import type { Metadata } from 'next';
import TimePanel from '@/components/dashboard/TimePanel';

export const metadata: Metadata = { title: 'Clock & schedules | Programmable Banking Sandbox' };

export default function Page() {
  return <TimePanel />;
}
