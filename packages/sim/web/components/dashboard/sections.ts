import {
  ArrowLeftRight,
  Clock,
  CreditCard,
  Database,
  ScrollText,
  Settings,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// The dashboard's pages, in the order the navigation lists them. The desktop
// app (Investec Sandbox) shows the same pages in its own sidebar.
export type Section = { href: string; label: string; icon: LucideIcon };
export type SectionGroup = { label: string; sections: Section[] };

export const SECTION_GROUPS: SectionGroup[] = [
  {
    label: 'Banking',
    sections: [
      { href: '/accounts', label: 'Accounts', icon: Wallet },
      { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
      { href: '/cards', label: 'Cards', icon: CreditCard },
      { href: '/beneficiaries', label: 'Beneficiaries', icon: Users },
    ],
  },
  {
    label: 'Simulate',
    sections: [
      { href: '/simulate/clock', label: 'Clock & schedules', icon: Clock },
      { href: '/simulate/faults', label: 'Faults', icon: Zap },
    ],
  },
  {
    label: 'Sandbox',
    sections: [
      { href: '/sandbox', label: 'Data & scenarios', icon: Database },
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/logs', label: 'Request log', icon: ScrollText },
    ],
  },
];

// Where the dashboard opens.
export const HOME = '/accounts';
