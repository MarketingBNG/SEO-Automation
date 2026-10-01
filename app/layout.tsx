import type { Metadata } from 'next';
import { Inter, Lora } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const lora = Lora({ variable: '--font-lora', subsets: ['latin'], style: ['normal', 'italic'] });

export const metadata: Metadata = {
  title: 'USAIndiaCFO - Growth Center',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport = { themeColor: '#1B2A5E' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${lora.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
