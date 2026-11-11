import type { Metadata } from 'next';
import BeneficiariesPanel from '@/components/dashboard/BeneficiariesPanel';

export const metadata: Metadata = { title: 'Beneficiaries | Programmable Banking Sandbox' };

export default function Page() {
  return <BeneficiariesPanel />;
}
