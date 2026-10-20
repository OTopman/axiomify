import type { Metadata } from 'next';
import '../index.css';
import { StoreProvider } from '../store/StoreProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Axiomify Studio',
  description: 'Next-generation API development and observability studio for Axiomify apps.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
