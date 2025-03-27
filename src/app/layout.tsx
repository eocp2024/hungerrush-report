import './globals.css';
import type { Metadata } from 'next';
import { Inter } from "next/font/google";
import { StatusProvider } from "@/lib/contexts/StatusContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'HungerRush Sales Summary',
  description: 'Generate sales summary from HungerRush',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <StatusProvider>
          {children}
        </StatusProvider>
      </body>
    </html>
  );
}
