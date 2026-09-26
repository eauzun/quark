import type { Metadata, Viewport } from 'next';
import Providers from '@/components/providers';
import './globals.css';
export const metadata: Metadata = { title: 'Quark | Work that builds Monad', description: 'Find focused work, verify your skills, and get paid in MON on Monad.', manifest: '/manifest.webmanifest', icons: { icon: '/icon.svg', apple: '/icon-192.png' }, appleWebApp: { capable: true, title: 'Quark', statusBarStyle: 'black-translucent' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b0812' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><Providers>{children}</Providers></body></html>; }
