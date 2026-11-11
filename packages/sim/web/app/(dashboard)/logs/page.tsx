import type { Metadata } from 'next';
import RequestLog from '@/components/dashboard/RequestLog';

export const metadata: Metadata = { title: 'Request log | Programmable Banking Sandbox' };

export default function Page() {
  return <RequestLog />;
}
