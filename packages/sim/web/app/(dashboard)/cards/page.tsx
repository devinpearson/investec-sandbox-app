import type { Metadata } from 'next';
import CardsPanel from '@/components/dashboard/CardsPanel';
import PendingHoldsPanel from '@/components/dashboard/PendingHoldsPanel';

export const metadata: Metadata = { title: 'Cards | Programmable Banking Sandbox' };

export default function Page() {
  return (
    <>
      <CardsPanel />
      <PendingHoldsPanel />
    </>
  );
}
