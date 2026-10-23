import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Shell } from '@/components/shell';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });

export const metadata: Metadata = { title: 'USAIndiaCFO - Social Media Marketing' };
export const viewport = { themeColor: '#1B2A5E' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
