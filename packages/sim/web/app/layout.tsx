import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import Navigation from '@/components/Navigation';
import { ToastProvider } from '@/components/ToastProvider';

export const metadata: Metadata = {
  title: 'Programmable Banking Sandbox',
  description: 'A local sandbox that emulates the Investec Programmable Banking APIs',
  icons: { icon: '/sandbox.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* The desktop app serves the addresses it chose here (see lib/desktop.ts). */}
        <Script src="/sandbox-config.js" strategy="beforeInteractive" />
        <ToastProvider>
          <Navigation />
          <main>{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
