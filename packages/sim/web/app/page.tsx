'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HOME } from '@/components/dashboard/sections';

// The dashboard opens on its first page. A client-side redirect, so the
// dashboard also works as static files.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(HOME);
  }, [router]);
  return null;
}
