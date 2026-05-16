import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  title: "Mochimo Tasks — Earn $MCM for contributing",
  description:
    "Complete social, content, referral, and daily tasks to earn Mochimo points. Quantum-resistant. Community-powered.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "Mochimo Tasks",
    description: "Earn $MCM for contributing to the Mochimo community.",
    images: ["/mcm-logo.jpg"],
  },
  icons: { icon: "/mcm-logo.jpg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Navbar />
        <main className="min-h-[calc(100vh-4rem)]">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
